from channels.generic.websocket import AsyncWebsocketConsumer
import json


class EchoConsumer(AsyncWebsocketConsumer):
    async def connect(self):  # noqa: D401
        await self.accept()
        await self.send_json({'message': 'connected'})

    async def disconnect(self, code):  # noqa: D401
        # Nothing special for now
        pass

    async def receive(self, text_data=None, bytes_data=None):  # noqa: D401
        if text_data:
            try:
                data = json.loads(text_data)
            except Exception:
                data = {'raw': text_data}
            await self.send_json({'echo': data})
        elif bytes_data:
            await self.send(bytes_data=bytes_data)

    async def send_json(self, data):
        await self.send(text_data=json.dumps(data))
