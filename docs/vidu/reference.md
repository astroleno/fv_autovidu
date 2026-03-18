参考生视频
参考生视频分为音视频直出、视频直出功能，二者使用相同的接口地址与请求方式，请求体不同，参考下方示例。

参考生视频-音视频直出：您可以指定视频中的主体用台词对话，直接生成完整的音视频；
参考生视频-视频直出：为视频的场景配置对应背景音乐，不含台词。
viduq2-pro模型，目前仅支持非主体调用
请求地址
POST https://api.vidu.cn/ent/v2/reference2video

请求头
字段	值	描述
Content-Type	application/json	数据交换格式
Authorization	Token {your api key}	将 {your api key} 替换为您的 token
主体调用（支持音视频功能）
请求体
参数名称	子参数	类型	必填	参数描述
model		String	是	模型名称可选值：viduq2、viduq1、vidu2.0
- viduq2：动态效果好，生成细节丰富
- viduq1：画面清晰，平滑转场，运镜稳定
- vidu2.0：生成速度快
subjects		List[Array]	是	图片主体信息支持1-7个主体，主体图片共1 ～ 7张
id	String	是	主体id，后续生成时可以通过@主体id的方式使用
images	Array{String}	是	该主体对应的图片url，每个主体最多支持3张图片
注1：支持传入图片 Base64 编码或图片URL（确保可访问）
注2：图片支持 png、jpeg、jpg、webp格式
注3：图片像素不能小于 128*128，且比例需要小于1:4或者4:1，且大小不超过50M。
注4：请注意，http请求的post body不超过20MB，且编码必须包含适当的内容类型字符串，例如：
data:image/png;base64,{base64_encode}
voice_id	String	可选	音色ID用来决定视频中的声音音色，为空时系统会自动推荐，可选枚举值参考列表：新音色列表
或者您可以使用声音复刻API来复刻任意音色，voice_id可以互通
prompt		String	是	文本提示词生成视频的文本描述。
注1：字符长度不能超过 5000 个字符
注2：使用sujects主体参数时，可以通过@主体id 来表示主体内容，例如："@1 和 @2 在一起吃火锅，并且旁白音说火锅大家都爱吃。"
audio		Bool	可选	是否使用音视频直出能力，默认false，可选值 true、false
- true：使用音视频直出能力。
- false：不使用音视频直出能力。
audio_type		String	可选	音频类型，audio为true时必填，默认为all
- all：音效+人声
- speech_only：仅人声- sound_effect_only：仅音效
duration		Int	可选	视频时长参数，默认值依据模型而定：
viduq2：默认5秒，可选：1-10
viduq1：默认5秒，可选：5
vidu2.0：默认4秒，可选：4
seed		Int	可选	随机种子当默认不传或者传0时，会使用随机数替代手动设置则使用设置的种子
aspect_ratio		String	可选	比例默认 16:9，可选值如下：16:9、9:16、1:1
注：q2模型 支持任意宽高比
resolution		String	可选	分辨率参数，默认值依据模型和视频时长而定：
viduq2 （1-10秒）：默认 720p, 可选：540p、720p、1080p
viduq1 （5秒）：默认 1080p, 可选：1080p
vidu2.0 （4秒）：默认 360p, 可选：360p、720p
movement_amplitude		String	可选	运动幅度默认 auto，可选值：auto、small、medium、large
注：使用q2模型时该参数不生效
payload		String	可选	透传参数不做任何处理，仅数据传输注：最多 1048576个字符
off_peak		Bool	可选	错峰模式，默认为：false，可选值：
- true：错峰生成视频；
- false：即时生成视频；
注1：错峰模式消耗的积分更低，具体请查看产品定价
注2：错峰模式下提交的任务，会在48小时内生成，未能完成的任务会被自动取消，并返还该任务的积分；
注3：您也可以手动取消错峰任务
注4：音视频直出功能不支持错峰模式
watermark		Bool	可选	是否添加水印
- true：添加水印；
- false：不添加水印；
注1：目前水印内容为固定，内容由AI生成，默认不加
注2：您可以通过watermarked_url参数查询获取带水印的视频内容，详情见查询任务接口
wm_position		Int	可选	水印位置，表示水印出现在图片的位置，默认为：3，可选项为：
1：左上角
2：右上角
3：右下角
4：左下角
wm_url		String	可选	水印内容，此处为图片URL不传时，使用默认水印：内容由AI生成
meta_data		String	可选	元数据标识，json格式字符串，透传字段，您可以 自定义格式 或使用 示例格式 ，示例如下：
{
"Label": "your_label","ContentProducer": "yourcontentproducer","ContentPropagator": "your_content_propagator","ProduceID": "yourproductid", "PropagateID": "your_propagate_id","ReservedCode1": "yourreservedcode1", "ReservedCode2": "your_reserved_code2"
}
该参数为空时，默认使用vidu生成的元数据标识
callback_url		String	可选	Callback 协议
需要您在创建任务时主动设置 callback_url，请求方法为 POST，当视频生成任务有状态变化时，Vidu 将向此地址发送包含任务最新状态的回调请求。回调请求内容结构与查询任务API的返回体一致
回调返回的"status"包括以下状态：
- processing 任务处理中
- success 任务完成（如发送失败，回调三次）
- failed 任务失败（如发送失败，回调三次）
Vidu采用回调签名算法进行认证，详情见：回调签名算法
curl -X POST -H "Authorization: Token {your_api_key}" -H "Content-Type: application/json" -d '
{
    "model": "viduq2",
    "subjects": [
        {
            "id": "your_subject1_id",
            "images": ["your_image_url1","your_image_url2","your_image_url3"],
            "voice_id": ""
        },
        {
            "id": "your_subject2_id",
            "images": ["your_image_url4","your_image_url5","your_image_url6"],
            "voice_id": ""
        }
    ],
    "prompt": "@your_subject1_id 和 @your_subject2_id 在一起吃火锅，并且旁白音说火锅大家都爱吃。",
    "duration": 8,
    "audio":true
}' https://api.vidu.cn/ent/v2/reference2video
响应体
字段	类型	描述
task_id	String	Vidu 生成的任务ID
state	String	处理状态
可选值：
created 创建成功
queueing 任务排队中
processing 任务处理中
success 任务成功
failed 任务失败
model	String	本次调用的模型名称
prompt	String	本次调用的提示词参数
images	Array[String]	本次调用的图像参数
duration	Int	本次调用的视频时长参数
seed	Int	本次调用的随机种子参数
aspect_ratio	String	本次调用的 比例 参数
resolution	String	本次调用的分辨率参数
bgm	Bool	本次调用的背景音乐参数
audio	Bool	本次调用是否开启音视频直出
audio_type	String	本次调用输出的音频类型
movement_amplitude	String	本次调用的镜头动态幅度参数
payload	String	本次调用时传入的透传参数
off_peak	Bool	本次调用时是否使用错峰模式
credits	Int	本次调用使用的积分数
watermark	Bool	本次提交任务是否使用水印
created_at	String	任务创建时间
{
  "task_id": "your_task_id_here",
  "state": "created",
  "model": "viduq2",
  "images": ["your_image_url1","your_image_url2"],
  "prompt": "@1 和 @2 在一起吃火锅，并且旁白音说火锅大家都爱吃。",
  "duration": 8,
  "seed": random_number,
  "aspect_ratio": "3:4",
  "resolution": "1080p",
  "movement_amplitude": "auto",
  "payload":"",
  "off_peak": false,
  "credits":credits_number,
  "created_at": "2025-01-01T15:41:31.968916Z"
}
非主体调用（视频生成）
请求体
参数名称	子参数	类型	必填	参数描述
model		String	是	模型名称可选值：viduq2-pro、viduq2、viduq1、vidu2.0
- viduq2-pro：支持参考视频，支持视频编辑，视频替换
- viduq2：动态效果好，生成细节丰富
- viduq1：画面清晰，平滑转场，运镜稳定
- vidu2.0：生成速度快
images		Array[String]	是	图像参考支持上传1～7张图片，模型将以此参数中传入的图片中的主题为参考生成具备主体一致的视频。
注1： viduq2、viduq1、vidu2.0模型支持上传1～7张图片
注2：使用viduq2-pro模型时，如果不上传视频，则支持上传1-7张图，如果上传视频则支持1-4张图
注3：支持传入图片 Base64 编码或图片URL（确保可访问）
注4：图片支持 png、jpeg、jpg、webp格式
注5：图片像素不能小于 128*128，且比例需要小于1:4或者4:1，且大小不超过50M。
注6：请注意，http请求的post body不超过20MB，且编码必须包含适当的内容类型字符串，例如：data:image/png;base64,{base64_encode}
videos		Array[String]	是	视频参考支持上传1～2个视频，模型将以此参数中传入的视频作为参考，生成具备主体一致的视频。
注1： 仅viduq2-pro模型支持该参数
注2：使用视频参考功能时，最多支持上传 1个8秒 视频 或 2个5秒 视频
注3：视频支持 mp4、avi、mov格式
注4：视频像素不能小于 128*128，且比例需要小于1:4或者4:1，且大小不超过100M。
注5：请注意，base64 decode之后的字节长度需要小于20M，且编码必须包含适当的内容类型字符串，例如：data:video/mp4;base64,{base64_encode}
prompt		String	是	文本提示词生成视频的文本描述。
注：字符长度不能超过 5000 个字符。
bgm		Bool	可选	是否为生成的视频添加背景音乐。默认：false，可选值 true 、false
- 传 true 时系统将从预设 BGM 库中自动挑选合适的音乐并添加；不传或为 false 则不添加 BGM。
- BGM不限制时长，系统根据视频时长自动适配
- BGM参数在q2系列模型的duration为 9秒 或 10秒 时不生效
duration		Int	可选	视频时长参数，默认值依据模型而定：
viduq2-pro：默认5秒，可选：0-10（0秒为自动判断时长）
viduq2：默认5秒，可选：1-10
viduq1：默认5秒，可选：5
vidu2.0：默认4秒，可选：4
seed		Int	可选	随机种子当默认不传或者传0时，会使用随机数替代手动设置则使用设置的种子
aspect_ratio		String	可选	比例默认 16:9，可选值如下：16:9、9:16、4:3、3:4、1:1
注：4:3、3:4仅支持q2系列模型
resolution		String	可选	分辨率参数，默认值依据模型和视频时长而定：
viduq2-pro （0-10秒）：默认 720p, 可选：540p、720p、1080p
viduq2 （1-10秒）：默认 720p, 可选：540p、720p、1080p
viduq1 （5秒）：默认 1080p, 可选：1080p
vidu2.0 （4秒）：默认 360p, 可选：360p、720p
movement_amplitude		String	可选	运动幅度默认 auto，可选值：auto、small、medium、large
注：使用q2系列模型时该参数不生效
payload		String	可选	透传参数不做任何处理，仅数据传输
注：最多 1048576个字符
off_peak		Bool	可选	错峰模式，默认为：false，可选值：
- true：错峰生成视频；
- false：即时生成视频；
注1：错峰模式消耗的积分更低，具体请查看产品定价；
注2：错峰模式下提交的任务，会在48小时内生成，未能完成的任务会被自动取消，并返还该任务的积分；
注3：您也可以手动取消错峰任务；
注4：音视频直出功能不支持错峰模式；
watermark		Bool	可选	是否添加水印
- true：添加水印；
- false：不添加水印；
注1：目前水印内容为固定，内容由AI生成，默认不加
注2：您可以通过watermarked_url参数查询获取带水印的视频内容，详情见查询任务接口
wm_position		Int	可选	水印位置，表示水印出现在图片的位置，默认为：3，可选项为：
1：左上角
2：右上角
3：右下角
4：左下角
wm_url		String	可选	水印内容，此处为图片URL不传时，使用默认水印：内容由AI生成
meta_data		String	可选	元数据标识，json格式字符串，透传字段，您可以 自定义格式 或使用 示例格式 ，示例如下：
{
"Label": "your_label","ContentProducer": "your_content_producer","ContentPropagator": "your_content_propagator","ProduceID": "your_product_id", "PropagateID": "your_propagate_id","ReservedCode1": "your_reserved_code1", "ReservedCode2": "your_reserved_code2"
}
该参数为空时，默认使用vidu生成的元数据标识
callback_url		String	可选	Callback 协议
需要您在创建任务时主动设置 callback_url，请求方法为 POST，当视频生成任务有状态变化时，Vidu 将向此地址发送包含任务最新状态的回调请求。回调请求内容结构与查询任务API的返回体一致
回调返回的"status"包括以下状态：
- processing 任务处理中
- success 任务完成（如发送失败，回调三次）
- failed 任务失败（如发送失败，回调三次）
Vidu采用回调签名算法进行认证，详情见：回调签名算法
curl -X POST -H "Authorization: Token {your_api_key}" -H "Content-Type: application/json" -d '
{
    "model": "viduq2-pro",
    "images": ["https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-1.png","https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-2.png","https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-3.png"],
    "videos": ["your_video1","your_video2"],
    "prompt": "Santa Claus and the bear hug by the lakeside.",
    "duration": 5,
    "seed": 0,
    "aspect_ratio": "3:4",
    "resolution": "540p",
    "movement_amplitude": "auto",
    "off_peak": false
}' https://api.vidu.cn/ent/v2/reference2video
响应体
字段	类型	描述
task_id	String	Vidu 生成的任务ID
state	String	处理状态
可选值：
created 创建成功
queueing 任务排队中
processing 任务处理中
success 任务成功
failed 任务失败
model	String	本次调用的模型名称
prompt	String	本次调用的提示词参数
images	Array[String]	本次调用的图像参数
videos	Array[String]	本次调用的视频参数
duration	Int	本次调用的视频时长参数
seed	Int	本次调用的随机种子参数
aspect_ratio	String	本次调用的 比例 参数
resolution	String	本次调用的分辨率参数
bgm	Bool	本次调用的背景音乐参数
audio	Bool	本次调用是否开启音视频直出
movement_amplitude	String	本次调用的镜头动态幅度参数
payload	String	本次调用时传入的透传参数
off_peak	Bool	本次调用时是否使用错峰模式
credits	Int	本次调用使用的积分数
watermark	Bool	本次提交任务是否使用水印
created_at	String	任务创建时间
{
  "task_id": "your_task_id_here",
  "state": "created",
  "model": "viduq2-pro",
  "images": ["https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-1.png","https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-2.png","https://prod-ss-images.s3.cn-northwest-1.amazonaws.com.cn/vidu-maas/template/reference2video-3.png"],
  "videos": ["your_video1","your_video2"],
  "prompt": "Santa Claus and the bear hug by the lakeside.",
  "duration": 5,
  "seed": random_number,
  "aspect_ratio": "3:4",
  "resolution": "540p",
  "movement_amplitude": "auto",
  "payload":"",
  "off_peak": false,
  "credits":credits_number,
  "created_at": "2025-01-01T15:41:31.968916Z"
}