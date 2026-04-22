> ## Documentation Index
> Fetch the complete documentation index at: https://docs.apimart.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Gemini 原生格式

>  - 使用 Google 原生 API 格式调用 Gemini 模型
- 同步处理模式，实时返回对话内容
- 最简化参数，快速上手 

<RequestExample>
  ```bash cURL theme={null}
  curl --request POST \
    --url https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent \
    --header 'Authorization: Bearer <token>' \
    --header 'Content-Type: application/json' \
    --data '{
    "contents": [
      {
        "role": "user",
        "parts": [
          {
            "text": "你好，介绍一下自己"
          }
        ]
      }
    ]
  }'
  ```

  ```python Python theme={null}
  import requests

  url = "https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent"

  payload = {
      "contents": [
          {
              "role": "user",
              "parts": [
                  {
                      "text": "你好，介绍一下自己"
                  }
              ]
          }
      ]
  }

  headers = {
      "Authorization": "Bearer <token>",
      "Content-Type": "application/json"
  }

  response = requests.post(url, json=payload, headers=headers)

  print(response.json())
  ```

  ```javascript JavaScript theme={null}
  const url = "https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent";

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "你好，介绍一下自己"
          }
        ]
      }
    ]
  };

  const headers = {
    "Authorization": "Bearer <token>",
    "Content-Type": "application/json"
  };

  fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => console.log(data))
    .catch(error => console.error('Error:', error));
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
      url := "https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent"

      payload := map[string]interface{}{
          "contents": []map[string]interface{}{
              {
                  "role": "user",
                  "parts": []map[string]interface{}{
                      {
                          "text": "你好，介绍一下自己",
                      },
                  },
              },
          },
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
          String url = "https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent";

          String payload = """
          {
            "contents": [
              {
                "role": "user",
                "parts": [
                  {
                    "text": "你好，介绍一下自己"
                  }
                ]
              }
            ]
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

  $url = "https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent";

  $payload = [
      "contents" => [
          [
              "role" => "user",
              "parts" => [
                  [
                      "text" => "你好，介绍一下自己"
                  ]
              ]
          ]
      ]
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

  url = URI("https://api.apimart.ai/v1beta/models/gemini-2.5-pro:generateContent")

  payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "你好，介绍一下自己"
          }
        ]
      }
    ]
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
</RequestExample>

<ResponseExample>
  ```json 200 theme={null}
  {
    "code": 200,
    "data": {
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": [
              {
                "text": "你好！很高兴能向你介绍我自己。\n\n我是一个大型语言模型，由 Google 训练和开发..."
              }
            ]
          },
          "finishReason": "STOP",
          "index": 0,
          "safetyRatings": [
            {
              "category": "HARM_CATEGORY_HATE_SPEECH",
              "probability": "NEGLIGIBLE"
            }
          ]
        }
      ],
      "promptFeedback": {
        "safetyRatings": [
          {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "probability": "NEGLIGIBLE"
          }
        ]
      ]
    },
    "usageMetadata": {
      "promptTokenCount": 4,
      "candidatesTokenCount": 611,
      "totalTokenCount": 2422,
      "thoughtsTokenCount": 1807,
      "promptTokensDetails": [
        {
          "modality": "TEXT",
          "tokenCount": 4
        }
      ]
    }
  }
  ```

  ```json 400 theme={null}
  {
    "error": {
      "code": 400,
      "message": "无效的请求参数",
      "status": "INVALID_ARGUMENT"
    }
  }
  ```

  ```json 401 theme={null}
  {
    "error": {
      "code": 401,
      "message": "认证失败，请检查 API Key",
      "status": "UNAUTHENTICATED"
    }
  }
  ```

  ```json 402 theme={null}
  {
    "error": {
      "code": 402,
      "message": "余额不足，请充值",
      "status": "PAYMENT_REQUIRED"
    }
  }
  ```

  ```json 403 theme={null}
  {
    "error": {
      "code": 403,
      "message": "没有访问权限",
      "status": "PERMISSION_DENIED"
    }
  }
  ```

  ```json 404 theme={null}
  {
    "error": {
      "code": 404,
      "message": "找不到指定的模型",
      "status": "NOT_FOUND"
    }
  }
  ```

  ```json 429 theme={null}
  {
    "error": {
      "code": 429,
      "message": "请求过于频繁，请稍后重试",
      "status": "RESOURCE_EXHAUSTED"
    }
  }
  ```

  ```json 500 theme={null}
  {
    "error": {
      "code": 500,
      "message": "服务器内部错误",
      "status": "INTERNAL"
    }
  }
  ```

  ```json 502 theme={null}
  {
    "error": {
      "code": 502,
      "message": "网关错误，服务暂时不可用",
      "status": "BAD_GATEWAY"
    }
  }
  ```

  ```json 503 theme={null}
  {
    "error": {
      "code": 503,
      "message": "服务暂时不可用",
      "status": "UNAVAILABLE"
    }
  }
  ```
</ResponseExample>

## Authorizations

<ParamField header="Authorization" type="string" required>
  所有接口均需要使用Bearer Token进行认证

  获取 API Key：

  访问 [API Key 管理页面](https://apimart.ai/keys) 获取您的 API Key

  使用时在请求头中添加：

  ```
  Authorization: Bearer YOUR_API_KEY
  ```
</ParamField>

## Path Parameters

<ParamField path="model" type="string" required>
  模型名称

  示例中使用 `gemini-2.5-pro`，您可以将其替换为其他支持的 Gemini 模型：

  * `gemini-2.5-flash` - Gemini 2.5 快速版
  * `gemini-2.5-pro` - Gemini 2.5 专业版
  * `gemini-2.5-flash-lite` - Gemini 2.5 超轻量版
  * `gemini-2.5-pro-thinking` - Gemini 2.5 Pro 深度思考版
</ParamField>

<ParamField path="method" type="enum<string>" required>
  生成方法（快速开始推荐使用 `generateContent`）：

  * `generateContent`: 等待完整响应后一次性返回
  * `streamGenerateContent`: 流式返回，逐块实时返回内容

  可选值：`generateContent`, `streamGenerateContent`
</ParamField>

## Body

<ParamField body="contents" type="array" required>
  对话内容列表

  最少需要1条消息

  <Expandable title="contents 对象结构">
    <ParamField body="role" type="string" required>
      角色类型：

      * `user`: 用户消息
      * `model`: 模型响应（对话历史中使用）
    </ParamField>

    <ParamField body="parts" type="array" required>
      消息内容部分

      <Expandable title="parts 对象结构">
        <ParamField body="text" type="string">
          文本内容
        </ParamField>

        <ParamField body="inlineData" type="object">
          内联数据（用于多模态输入）

          <Expandable title="inlineData 属性">
            <ParamField body="mimeType" type="string">
              MIME 类型，如 `image/jpeg`, `image/png`
            </ParamField>

            <ParamField body="data" type="string">
              Base64 编码的数据
            </ParamField>
          </Expandable>
        </ParamField>
      </Expandable>
    </ParamField>
  </Expandable>

  示例：

  ```json theme={null}
  [
    {
      "role": "user",
      "parts": [{ "text": "你好，介绍一下自己" }]
    }
  ]
  ```
</ParamField>

<ParamField body="generationConfig" type="object">
  生成配置（可选）

  <Expandable title="generationConfig 属性">
    <ParamField body="temperature" type="number">
      控制输出随机性，范围 0.0-2.0

      * 较低的值使输出更确定
      * 较高的值使输出更随机

      默认值：1.0
    </ParamField>

    <ParamField body="maxOutputTokens" type="integer">
      生成的最大 token 数量

      不同模型有不同的最大值限制
    </ParamField>

    <ParamField body="topP" type="number">
      核采样参数，范围 0.0-1.0

      控制采样时考虑的概率质量
    </ParamField>

    <ParamField body="topK" type="integer">
      Top-K 采样参数

      每步只从概率最高的 K 个 token 中采样
    </ParamField>

    <ParamField body="stopSequences" type="array">
      停止序列列表

      遇到这些序列时停止生成
    </ParamField>
  </Expandable>
</ParamField>

<ParamField body="safetySettings" type="array">
  安全设置（可选）

  <Expandable title="safetySettings 对象结构">
    <ParamField body="category" type="string">
      安全类别：

      * `HARM_CATEGORY_HATE_SPEECH`: 仇恨言论
      * `HARM_CATEGORY_DANGEROUS_CONTENT`: 危险内容
      * `HARM_CATEGORY_HARASSMENT`: 骚扰
      * `HARM_CATEGORY_SEXUALLY_EXPLICIT`: 色情内容
    </ParamField>

    <ParamField body="threshold" type="string">
      阈值级别：

      * `BLOCK_NONE`: 不阻止
      * `BLOCK_ONLY_HIGH`: 仅阻止高风险
      * `BLOCK_MEDIUM_AND_ABOVE`: 阻止中等及以上风险
      * `BLOCK_LOW_AND_ABOVE`: 阻止低等及以上风险
    </ParamField>
  </Expandable>
</ParamField>

## Response

<ResponseField name="candidates" type="array">
  候选响应列表

  <Expandable title="candidates 对象结构">
    <ResponseField name="content" type="object">
      生成的内容

      <Expandable title="content 属性">
        <ResponseField name="role" type="string">
          角色，通常为 `model`
        </ResponseField>

        <ResponseField name="parts" type="array">
          内容部分列表

          <Expandable title="parts 对象">
            <ResponseField name="text" type="string">
              生成的文本内容
            </ResponseField>
          </Expandable>
        </ResponseField>
      </Expandable>
    </ResponseField>

    <ResponseField name="finishReason" type="string">
      完成原因：

      * `STOP`: 正常结束
      * `MAX_TOKENS`: 达到最大 token 限制
      * `SAFETY`: 因安全原因停止
      * `RECITATION`: 因重复内容停止
      * `OTHER`: 其他原因
    </ResponseField>

    <ResponseField name="index" type="integer">
      候选响应的索引
    </ResponseField>

    <ResponseField name="safetyRatings" type="array">
      安全评级列表

      <Expandable title="safetyRatings 对象">
        <ResponseField name="category" type="string">
          安全类别
        </ResponseField>

        <ResponseField name="probability" type="string">
          概率级别：`NEGLIGIBLE`, `LOW`, `MEDIUM`, `HIGH`
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="promptFeedback" type="object">
  提示词反馈信息

  <Expandable title="promptFeedback 属性">
    <ResponseField name="safetyRatings" type="array">
      提示词的安全评级
    </ResponseField>

    <ResponseField name="blockReason" type="string">
      阻止原因（如果提示词被阻止）
    </ResponseField>
  </Expandable>
</ResponseField>

<ResponseField name="usageMetadata" type="object">
  使用量统计

  <Expandable title="usageMetadata 属性">
    <ResponseField name="promptTokenCount" type="integer">
      提示词消耗的 token 数
    </ResponseField>

    <ResponseField name="candidatesTokenCount" type="integer">
      候选响应消耗的 token 数
    </ResponseField>

    <ResponseField name="totalTokenCount" type="integer">
      总消耗 token 数
    </ResponseField>

    <ResponseField name="thoughtsTokenCount" type="integer">
      思考过程消耗的 token 数（如适用）
    </ResponseField>

    <ResponseField name="promptTokensDetails" type="array">
      提示词 token 详情

      <Expandable title="promptTokensDetails 对象">
        <ResponseField name="modality" type="string">
          模态类型：`TEXT`, `IMAGE`, 等
        </ResponseField>

        <ResponseField name="tokenCount" type="integer">
          该模态的 token 数量
        </ResponseField>
      </Expandable>
    </ResponseField>
  </Expandable>
</ResponseField>
