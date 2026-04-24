> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# GPT-Image-2 官方渠道 图像生成

>  - OpenAI 官方 `gpt-image-2` 模型，基于 `/v1/images/generations` 兼容协议
- 异步处理模式，返回 `task_id` 用于后续查询
- 文生图 / 图生图 / 局部重绘（mask）三合一
- 新增 `resolution` 档位字段，支持 1K / 2K / 4K 分辨率选择
- 支持 13 种比例（4K 档支持其中 6 个：16:9 / 9:16 / 2:1 / 1:2 / 21:9 / 9:21）
- 单次最多生成 4 张图片，参考图最多 16 张
- 与 `gpt-image-1.5-official` 接口 95% 对齐，迁移只需改模型名 

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.apimart.ai/v1/images/generations \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
      "model": "gpt-image-2-official",
      "prompt": "星空下的古老城堡",
      "size": "16:9",
      "resolution": "2k",
      "quality": "high",
      "n": 1
    }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1/images/generations"

  payload = {
      "model": "gpt-image-2-official",
      "prompt": "星空下的古老城堡",
      "size": "16:9",
      "resolution": "2k",
      "quality": "high",
      "n": 1
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1/images/generations";

  const payload = {
    model: "gpt-image-2-official",
    prompt: "星空下的古老城堡",
    size: "16:9",
    resolution: "2k",
    quality: "high",
    n: 1,
  };

  const headers = {
    Authorization: "Bearer <token>",
    "Content-Type": "application/json",
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
  })
    .then((response) => response.json())
    .then((data) => console.log(data))
    .catch((error) => console.error("Error:", error));
  ```

  ```go Go theme={null}
  package main

  import (
      "bytes"
      "encoding/json"
      "fmt"
      "io/ioutil"
      "net/http"
  )

  func main() {
      url := "https://api.apimart.ai/v1/images/generations"

      payload := map[string]interface{}{
          "model":      "gpt-image-2-official",
          "prompt":     "星空下的古老城堡",
          "size":       "16:9",
          "resolution": "2k",
          "quality":    "high",
          "n":          1,
      }

      jsonData, _ := json.Marshal(payload)

      req, _ := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
      req.Header.Set("Authorization", "Bearer <token>")
      req.Header.Set("Content-Type", "application/json")

      client := &http.Client{}
      resp, err := client.Do(req)
      if err != nil {
          panic(err)
      }
      defer resp.Body.Close()

      body, _ := ioutil.ReadAll(resp.Body)
      fmt.Println(string(body))
  }
  ```

  ```java Java theme={null}
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.net.URI;

  public class Main {
      public static void main(String[] args) throws Exception {
          String url = "https://api.apimart.ai/v1/images/generations";

          String payload = """
          {
            "model": "gpt-image-2-official",
            "prompt": "星空下的古老城堡",
            "size": "16:9",
            "resolution": "2k",
            "quality": "high",
            "n": 1
          }
          """;

          HttpClient client = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder()
              .uri(URI.create(url))
              .header("Authorization", "Bearer <token>")
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(payload))
              .build();

          HttpResponse<String> response = client.send(request,
              HttpResponse.BodyHandlers.ofString());

          System.out.println(response.body());
      }
  }
  ```

  ```php PHP theme={null}
  <?php

  $url = "https://api.apimart.ai/v1/images/generations";

  $payload = [
      "model" => "gpt-image-2-official",
      "prompt" => "星空下的古老城堡",
      "size" => "16:9",
      "resolution" => "2k",
      "quality" => "high",
      "n" => 1
  ];

  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer <token>",
      "Content-Type: application/json"
  ]);

  $response = curl_exec($ch);
  curl_close($ch);

  echo $response;
  ?>
  ```

  ```ruby Ruby theme={null}
  require 'net/http'
  require 'json'
  require 'uri'

  url = URI("https://api.apimart.ai/v1/images/generations")

  payload = {
    model: "gpt-image-2-official",
    prompt: "星空下的古老城堡",
    size: "16:9",
    resolution: "2k",
    quality: "high",
    n: 1
  }

  http = Net::HTTP.new(url.host, url.port)
  http.use_ssl = true

  request = Net::HTTP::Post.new(url)
  request["Authorization"] = "Bearer <token>"
  request["Content-Type"] = "application/json"
  request.body = payload.to_json

  response = http.request(request)
  puts response.body
  ```

  ```swift Swift theme={null}
  import Foundation

  let url = URL(string: "https://api.apimart.ai/v1/images/generations")!

  let payload: [String: Any] = [
      "model": "gpt-image-2-official",
      "prompt": "星空下的古老城堡",
      "size": "16:9",
      "resolution": "2k",
      "quality": "high",
      "n": 1
  ]

  var request = URLRequest(url: url)
  request.httpMethod = "POST"
  request.setValue("Bearer <token>", forHTTPHeaderField: "Authorization")
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

  let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
          print("Error: \(error)")
          return
      }

      if let data = data, let responseString = String(data: data, encoding: .utf8) {
          print(responseString)
      }
  }

  task.resume()
  ```

  ```csharp C# theme={null}
  using System;
  using System.Net.Http;
  using System.Text;
  using System.Threading.Tasks;

  class Program
  {
      static async Task Main(string[] args)
      {
          var url = "https://api.apimart.ai/v1/images/generations";

          var payload = @"{
              ""model"": ""gpt-image-2-official"",
              ""prompt"": ""星空下的古老城堡"",
              ""size"": ""16:9"",
              ""resolution"": ""2k"",
              ""quality"": ""high"",
              ""n"": 1
          }";

          using var client = new HttpClient();
          client.DefaultRequestHeaders.Add("Authorization", "Bearer <token>");

          var content = new StringContent(payload, Encoding.UTF8, "application/json");
          var response = await client.PostAsync(url, content);
          var result = await response.Content.ReadAsStringAsync();

          Console.WriteLine(result);
      }
  }
  ```

  ```dart Dart theme={null}
  import 'dart:convert';
  import 'package:http/http.dart' as http;

  void main() async {
    final url = Uri.parse('https://api.apimart.ai/v1/images/generations');

    final payload = {
      'model': 'gpt-image-2-official',
      'prompt': '星空下的古老城堡',
      'size': '16:9',
      'resolution': '2k',
      'quality': 'high',
      'n': 1,
    };

    final response = await http.post(
      url,
      headers: {
        'Authorization': 'Bearer <token>',
        'Content-Type': 'application/json',
      },
      body: jsonEncode(payload),
    );

    print(response.body);
  }
  ```

  ```r R theme={null}
  library(httr)
  library(jsonlite)

  url <- "https://api.apimart.ai/v1/images/generations"

  payload <- list(
    model = "gpt-image-2-official",
    prompt = "星空下的古老城堡",
    size = "16:9",
    resolution = "2k",
    quality = "high",
    n = 1
  )

  response <- POST(
    url,
    add_headers(
      Authorization = "Bearer <token>",
      `Content-Type` = "application/json"
    ),
    body = toJSON(payload, auto_unbox = TRUE),
    encode = "raw"
  )

  cat(content(response, "text"))
  ```
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": [
      {
        "status": "submitted",
        "task_id": "task_01KPTXXXXXXXXXXXXXXX"
      }
    ]
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "resolution 4k not supported for size 1:1, allowed: 1k / 2k",
      "type": "invalid_request_error"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "身份验证失败，请检查您的API密钥",
      "type": "authentication_error"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "账户余额不足，请充值后再试",
      "type": "payment_required"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "访问被禁止，您没有权限访问此资源",
      "type": "permission_error"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后再试",
      "type": "rate_limit_error"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误，请稍后重试",
      "type": "server_error"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "网关错误，服务器暂时不可用",
      "type": "bad_gateway"
    }
  }
  ```
</ResponseExample>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用 Bearer Token 进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/keys) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Body

<ParamField body="model" type="string" default="gpt-image-2-official" required>
  图像生成模型名称

  固定填写 `gpt-image-2-official`（OpenAI 官方 gpt-image-2 模型）
</ParamField>

<ParamField body="prompt" type="string" required>
  图像生成的文本描述

  * 支持中英文，建议详细描述
  * 提交前会经过平台敏感词 / 安全审核，命中违规内容会直接返回错误
</ParamField>

<ParamField body="size" type="string" default="1:1">
  画面比例

  对外使用比例值，系统内部按 `resolution` 自动映射到具体像素。

  支持 13 种比例：

  * `1:1` - 正方形构图（默认，社交头像 / Logo）
  * `3:2` - 横构图（单反相机常见比例）
  * `2:3` - 竖构图（海报竖版）
  * `4:3` - 横构图（经典显示器 / PPT）
  * `3:4` - 竖构图
  * `5:4` - 横构图
  * `4:5` - 竖构图（Instagram 竖版帖子）
  * `16:9` - 横构图（宽屏视频封面）
  * `9:16` - 竖构图（手机全屏 / 短视频封面）
  * `2:1` - 横构图（网页 Banner）
  * `1:2` - 竖构图
  * `21:9` - 横构图（电影超宽屏）
  * `9:21` - 竖构图
</ParamField>

<ParamField body="resolution" type="string" default="1k">
  分辨率档位（**新增字段**）

  控制实际出图清晰度。

  * `1k` - 1024 基准，省钱日常够用（默认）
  * `2k` - 2048 基准，适合海报 / 高清需求
  * `4k` - 3840 基准，**仅 6 个比例支持**（`16:9` / `9:16` / `2:1` / `1:2` / `21:9` / `9:21`）

  <Warning>
    不支持的 4K 组合会返回 400（受 OpenAI 单图总像素上限 8,294,400 限制）：

    * `1:1` × `4k` ❌（3840² = 14.7M 超上限）
    * `3:2` / `2:3` × `4k` ❌（3840×2560 = 9.83M 超上限）
    * `4:3` / `3:4` × `4k` ❌（3840×2880 = 11.06M 超上限）
    * `5:4` / `4:5` × `4k` ❌（3840×3072 = 11.80M 超上限）

    想高清上述比例时，改用 `resolution=2k`（最多 2048 边，总像素充裕）。
  </Warning>
</ParamField>

<ParamField body="quality" type="string" default="auto">
  图片质量

  * `auto` - 自动（默认，通常等同 `low`）
  * `low` - 快速省钱，轮廓够用
  * `medium` - 平衡
  * `high` - 最高精度（4K + high 耗时 >120s）
</ParamField>

<ParamField body="background" type="string" default="auto">
  背景模式

  * `auto` - 自动（默认）
  * `opaque` - 不透明
  * `transparent` - ⚠️ **gpt-image-2-official 不支持透明背景，传了会被系统静默降级为 `auto`**
</ParamField>

<ParamField body="moderation" type="string" default="auto">
  审核强度

  * `auto` - 默认审核强度
  * `low` - 更宽松的审核强度
</ParamField>

<ParamField body="output_format" type="string" default="png">
  输出格式

  * `png` - 默认
  * `jpeg` - 文件更小
  * `webp` - 现代浏览器最优
</ParamField>

<ParamField body="output_compression" type="integer">
  输出压缩强度，范围 `0-100`

  * 仅对 `jpeg` / `webp` 有效
</ParamField>

<ParamField body="n" type="integer" default="1">
  生成图片张数

  取值范围：`1 ~ 4`

  <Warning>
    必须输入纯数字（如 `1`），不要加引号
  </Warning>
</ParamField>

<ParamField body="image_urls" type="array">
  参考图 URL 数组

  <Expandable title="详细说明">
    * 最多 **16 张** 参考图，超过会被拒绝
    * 须是公网可直接访问的稳定图片 URL
  </Expandable>
</ParamField>

<ParamField body="mask_url" type="string">
  遮罩图 URL，用于局部重绘（inpainting）

  * 需搭配 `image_urls` 一起使用

  <Warning>
    1、上传遮罩图前，请先确认图片 Alpha 通道为「是」。

    2、遮罩图尺寸需与**首张参考图一致**。
  </Warning>
</ParamField>

## 尺寸 × 分辨率映射表

`size × resolution` → OpenAI 实际像素（13 比例 × 3 档位）：

| size   | `1k`      | `2k`      | `4k`          |
| ------ | --------- | --------- | ------------- |
| `1:1`  | 1024×1024 | 2048×2048 | ❌ 超像素上限       |
| `3:2`  | 1536×1024 | 2048×1360 | ❌ 超像素上限       |
| `2:3`  | 1024×1536 | 1360×2048 | ❌ 超像素上限       |
| `4:3`  | 1024×768  | 2048×1536 | ❌ 超像素上限       |
| `3:4`  | 768×1024  | 1536×2048 | ❌ 超像素上限       |
| `5:4`  | 1280×1024 | 2560×2048 | ❌ 超像素上限       |
| `4:5`  | 1024×1280 | 2048×2560 | ❌ 超像素上限       |
| `16:9` | 1536×864  | 2048×1152 | **3840×2160** |
| `9:16` | 864×1536  | 1152×2048 | **2160×3840** |
| `2:1`  | 2048×1024 | 2688×1344 | **3840×1920** |
| `1:2`  | 1024×2048 | 1344×2688 | **1920×3840** |
| `21:9` | 2016×864  | 2688×1152 | **3840×1648** |
| `9:21` | 864×2016  | 1152×2688 | **1648×3840** |

> 说明：`3:2` / `2:3` @ 2K 实际是 2048×1360（1360 为 16 倍数，近似 3:2，误差 \< 0.5%）；`21:9` @ 4K 是 3840×1648（精确 2.33:1）。其他均为精确比例。

## 使用场景示例

**文生图（最简请求）**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "星空下的古老城堡"
}
```

**2K 高清海报**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "赛博朋克夜景",
  "size": "16:9",
  "resolution": "2k",
  "quality": "high",
  "output_format": "jpeg",
  "output_compression": 90
}
```

**4K 壁纸**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "雪山日出全景",
  "size": "16:9",
  "resolution": "4k",
  "quality": "high",
  "n": 1
}
```

**图生图（多参考图融合）**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "将两张参考图融合成一张插画海报，保留主体轮廓",
  "size": "1:1",
  "quality": "high",
  "image_urls": [
    "https://your-cdn.com/input-a.png",
    "https://your-cdn.com/input-b.png"
  ]
}
```

**局部重绘（mask）**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "把背景换成沙漠日落",
  "size": "1:1",
  "quality": "medium",
  "image_urls": ["https://your-cdn.com/photo.png"],
  "mask_url": "https://your-cdn.com/mask.png"
}
```

**多张生成（n > 1）**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "Four minimalist poster variations of a red fox",
  "size": "1:1",
  "quality": "low",
  "n": 4
}
```

**直接传像素串（高级用法）**

```json theme={null}
{
  "model": "gpt-image-2-official",
  "prompt": "wide cinematic shot",
  "size": "3840x2160",
  "quality": "high"
}
```

## Response

<ResponseField name="code" type="integer">
  响应状态码
</ResponseField>

<ResponseField name="data" type="array">
  返回数据数组

  <Expandable title="属性">
    <ResponseField name="status" type="string">
      任务状态

      * `submitted` - 已提交
    </ResponseField>

    <ResponseField name="task_id" type="string">
      任务唯一标识符，用于后续查询任务结果
    </ResponseField>
  </Expandable>
</ResponseField>

## 查询任务结果

提交成功后返回 `task_id`，通过 `GET /v1/tasks/{task_id}` 轮询任务状态，详见 [任务查询接口](/cn/api-reference/tasks/get-task)。

### 成功响应示例

```json theme={null}
{
  "code": 200,
  "data": {
    "id": "task_01KPTXXXXXXXXXXXXXXX",
    "status": "completed",
    "progress": 100,
    "actual_time": 46,
    "result": {
      "images": [
        {
          "url": [
            "https://upload.apimart.ai/f/image/xxxxxxxx-gpt_image_2_official_task_xxx_0.png"
          ],
          "expires_at": 1776928569
        }
      ]
    }
  }
}
```

任务状态流转：`submitted` → `in_progress` → `completed` / `failed`。

取图方式：`data.result.images[0].url[0]`。

### 轮询建议

* **首次查询延迟**：提交后等待 10\~20 秒再开始查询
* **查询间隔**：建议 3\~5 秒一次
* **超时参考**：`high + 2k/4k` 组合耗时可达 130 秒，客户端超时建议 ≥ 180 秒
* **批量查询**：若需同时查询多个任务，请使用 `POST /v1/tasks/batch`
