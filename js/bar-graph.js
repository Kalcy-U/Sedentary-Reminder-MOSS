import { request, last_request, time_limit } from './request_gpt.js';
const Healthy = -1, Unhealthy = 1;
const INFINITY = 1.79E+308;
const INFINITY_LOWER = 1.78E+308;
const interval = 30 * 60 * 1000;
const graphWrapper = document.getElementById('graph-wrapper');
let labels = [];
let bars = {};
var from_time_in_bad_pose = INFINITY;
var res1_save = [];//储存了近期的采样结果
var pointer_head = 0;
var pointer_tail = 0;
const window_size = 50;//滑动窗口的大小。window_size次采样结果进行平滑处理。如果fps=12，约1min一次
var cur_state = Healthy;//当前分类结果 
//let res2_save = [];//储存了平滑处理后的采样结果
var sum_within_window = [0, 0, 0];   //窗口内预测标签的平均值
var sum_from_begin = [0, 0, 0]; //从上一次开始工作到现在预测标签的平均值
var time_last_rest = new Date().getTime();   //上一次检测到休息的时间


function process_timeline(data) {

  //处理与时序数据相关的问题
  if (pointer_head - pointer_tail > window_size) {
    //窗口超出预设大小 理论上不应该出现 截断尾巴
    res1_save.splice(pointer_tail % window_size, pointer_head - pointer_tail - window_size);
    pointer_tail = pointer_head - window_size;
  }

  if (pointer_head - pointer_tail == window_size) {
    //滑动串口填满 窗口向右滑动1格
    //splice() 方法可删除从 index 处开始的零个或多个元素，并且用参数列表中声明的一个或多个值来替换那些被删除的元素。
    let lastone = res1_save.splice(pointer_tail % window_size, 1, data);
    pointer_head += 1;
    pointer_tail += 1;

    lastone[0]["res"].forEach(({ className, probability }, index) => {
      sum_within_window[index] += (data["res"][index].probability - probability);
      sum_from_begin[index] += (data["res"][index].probability);
    });
  }

  else {
    //滑动窗口未填满
    res1_save.push(data);
    pointer_head += 1;
    data["res"].forEach(({ className, probability }, index) => {
      sum_within_window[index] += probability;
      sum_from_begin[index] += probability;
    });
  }

}

// these are the colors of our bars
let colors = ['#E67701', '#D84C6F', '#794AEF', '#1291D0'];
let lightColors = ['#FFECE2', '#FFE9EC', '#F1F0FF', '#E2F5FF'];

// This function makes the bar graph
// it takes in a URL to a teachable machine model,
// so we can retrieve the labels of our classes for the bars
export async function setupBarGraph(URL) {
  // the metatadata json file contains the text labels of your model
  const metadataURL = `${URL}metadata.json`;
  // get the metadata fdrom the file URL
  const response = await fetch(metadataURL);
  const json = await response.json();
  // get the names of the labels from the metadata of the model
  labels = json.labels;
  // get the area of the webpage we want to build the bar graph

  // make a bar in the graph for each label in the metadata
  labels.forEach((label, index) => makeBar(label, index));
}

// This function makes a bar in the graph
function makeBar(label, index) {
  // make the elements of the bar
  let barWrapper = document.createElement('div');
  let barEl = document.createElement('progress');
  let percentEl = document.createElement('span');
  let labelEl = document.createElement('span');
  labelEl.innerText = label;

  // assemble the elements
  barWrapper.appendChild(labelEl);
  barWrapper.appendChild(barEl);
  barWrapper.appendChild(percentEl);
  //let graphWrapper = document.getElementById('graph-wrapper');
  graphWrapper.appendChild(barWrapper);

  // style the elements
  let color = colors[index % colors.length];
  let lightColor = lightColors[index % colors.length];
  barWrapper.style.color = color;
  barWrapper.style.setProperty('--color', color);
  barWrapper.style.setProperty('--color-light', lightColor);

  // save references to each element, so we can update them later
  bars[label] = {
    bar: barEl,
    percent: percentEl
  };
}
function detect_and_request() {
  let cur_timesamp = new Date().getTime();
  let time_without_rest = cur_timesamp - time_last_rest;
  //let time_in_bad_pose = cur_timesamp - time_last_alert;
  let flag = false;
  let content = "";

  if (pointer_head > window_size) { //窗口已满才会开始
    //如果用户离开视野
    if (sum_within_window[2] / window_size > 0.8) {

      request("system", `用户离开视野，正在休息中。距离上一次休息间隔了${time_without_rest / 1000 / 60}分钟。`);
      time_last_rest = cur_timesamp;
      //初始化内存数据
      res1_save.splice(0, res1_save.length);
      pointer_head = 0;
      pointer_tail = 0;
      sum_within_window = [0, 0, 0];   //窗口内预测标签的平均值
      sum_from_begin = [0, 0, 0]; //从上一次开始工作到现在预测标签的平均值
      cur_state = Healthy;
    }
    else if (sum_within_window[0] / window_size > 0.6) {
      //窗口时间内用户坐姿良好
      if (cur_state > 0) {//如果是从不良坐姿变为良好
        if (request("system", "用户纠正了不良坐姿。"))//如果没有成功发送则保留状态
        {
          cur_state = Healthy;
          from_time_in_bad_pose = INFINITY;
        }
      }

    }
    else {

      if (time_without_rest > interval) {
        content += `用户已连续工作超过${(time_without_rest / 1000 / 60).toFixed(2)}分钟。`
      }
      else if (sum_within_window[1] / window_size > 0.7) {
        if (from_time_in_bad_pose >= INFINITY_LOWER) {

          content += `检测到用户坐姿不正确。`
          from_time_in_bad_pose = cur_timesamp;
        }
        else {
          let time_ = ((cur_timesamp - from_time_in_bad_pose) / 1000 / 60).toFixed(2)
          content += `检测到连续${time_}分钟用户坐姿不正确。`
          if (time_ > 8) {
            flag = true;
          }
        }
        cur_state = Unhealthy;
      }
      if (content != "" && cur_timesamp - last_request > time_limit)
        request("system", content + "请简短提醒。");
    }
  }
}

// This function takes data (retrieved in the model.js file)
// The data is in the form of an array of objects like this:
// [{ className:class1, probability:0.75 }, { className:class2, probability:0.25 }, ... ]
// it uses this data to update the progress and labels of of each bar in the graph
export function updateBarGraph(data) {
  //采样加入时间序列
  process_timeline(data);
  //计算当前滑动窗口内数据是否到达阈值并采取措施
  detect_and_request();
  // iterate through each element in the data

  data["res"].forEach(({ className, probability }, index) => {
    // get the HTML elements that we stored in the makeBar function

    let barElements = bars[className];
    let barElement = barElements.bar;
    let percentElement = barElements.percent;
    barElement.value = probability;

    // if (className == "Dab" && probability > 0.6) {
    //   document.getElementById("overlay").innerHTML = "🍓";
    // } else {
    //   if (className == "Floss" && probability > 0.6) {
    //     document.getElementById("overlay").innerHTML = "😍";
    //   } else {
    //     if (className == "Hair whip" && probability > 0.6) {
    //       document.getElementById("overlay").innerHTML = "🐼";
    //     }
    //   }
    // }

    // set the progress on the bar
    // set the percent value on the label
    percentElement.innerText = convertToPercent(probability);
  });

  //取出采样的时间戳，更新缓存记录
}

// This function converts a decimal number (between 0 and 1)
// to an integer percent (between 0% and 100%)
function convertToPercent(num) {
  num *= 100;
  num = Math.round(num);
  return `${num}%`;
}
