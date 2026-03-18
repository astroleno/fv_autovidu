curl --location -g --request POST 'https://yunwu.ai/v1beta/models/gemini-3-pro-image-preview:generateContent?key=sk-kpvHWZzAJpzPKxanJShAYVgLYP4HlVfQG6sQBg5KmA7iH8zW' \
--header 'Authorization: Bearer <token>' \
--header 'Content-Type: application/json' \
--data-raw '{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "'\''Hi, This is a picture of me. Can you add a llama next to me"
        },
        {
          "inline_data": {
            "mime_type": "image/jpeg",
            "data": “"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": [
      "TEXT",
      "IMAGE"
    ],
    "imageConfig": {
      "aspectRatio": "9:16",
      "imageSize":"1K"
    }
  }
}'
