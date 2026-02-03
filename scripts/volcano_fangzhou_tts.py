# 仅需安装第三方库：pip install requests
# hmac, hashlib, datetime, urllib3 为 Python 标准库，无需安装

import requests
import hmac
import hashlib
import datetime
import urllib3
from urllib.parse import urlencode

# 禁用不安全请求警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class VolcanoFangzhouTTS2:
    """火山方洲音频合成2.0 API调用类"""

    def __init__(self, access_key, secret_key):
        """
        初始化
        :param access_key: 火山引擎Access Key ID
        :param secret_key: 火山引擎Secret Access Key
        """
        self.access_key = access_key
        self.secret_key = secret_key
        self.api_url = "https://openspeech.bytedance.com/api/v1/tts/online"

    def _generate_signature(self, params, timestamp):
        """
        生成API请求签名（火山引擎签名规则）
        :param params: 请求参数
        :param timestamp: 时间戳
        :return: 签名结果
        """
        sorted_params = sorted(params.items())
        query_string = urlencode(sorted_params)
        string_to_sign = (
            f"GET\n{self.api_url.split('//')[1]}\n/api/v1/tts/online\n"
            f"{query_string}&timestamp={timestamp}"
        )
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).hexdigest()
        return signature

    def synthesize_audio(
        self,
        text,
        voice_type="BV001_streaming",
        format="mp3",
        speed=1.0,
        volume=1.0,
        output_path=None,
    ):
        """
        合成音频
        :param text: 要合成的文本内容
        :param voice_type: 音色类型（BV001_streaming为通用女声）
        :param format: 输出格式（mp3/wav）
        :param speed: 语速（0.5-2.0）
        :param volume: 音量（0.1-2.0）
        :param output_path: 可选，指定保存路径
        :return: 保存的音频文件路径，失败返回 None
        """
        try:
            timestamp = str(int(datetime.datetime.now().timestamp()))

            params = {
                "AccessKey": self.access_key,
                "Action": "GetTts",
                "Text": text,
                "VoiceType": voice_type,
                "Format": format,
                "Speed": speed,
                "Volume": volume,
                "Timestamp": timestamp,
            }

            signature = self._generate_signature(params, timestamp)
            params["Signature"] = signature

            response = requests.get(self.api_url, params=params, verify=False)

            if response.status_code == 200:
                audio_file = output_path or f"fangzhou_tts_{timestamp}.{format}"
                with open(audio_file, "wb") as f:
                    f.write(response.content)
                print(f"音频合成成功，文件已保存为：{audio_file}")
                return audio_file
            else:
                print(
                    f"音频合成失败，错误码：{response.status_code}，错误信息：{response.text}"
                )
                return None

        except Exception as e:
            print(f"合成过程出错：{str(e)}")
            return None


# ------------------- 调用示例 -------------------
if __name__ == "__main__":
    ACCESS_KEY = "your_access_key_here"
    SECRET_KEY = "your_secret_key_here"

    tts_client = VolcanoFangzhouTTS2(ACCESS_KEY, SECRET_KEY)

    text_to_synthesize = "你好，这是火山方洲音频合成2.0的测试语音。"
    tts_client.synthesize_audio(
        text=text_to_synthesize,
        voice_type="BV001_streaming",
        format="mp3",
        speed=1.0,
        volume=1.0,
    )
