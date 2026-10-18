# Generating images

OpenCrease can make images with an AI provider the user has set up in Settings, AI providers (OpenAI, Google Gemini, Replicate, fal, xAI, an OpenAI-compatible endpoint, or a local ComfyUI or Automatic1111). The server talks to the provider, so you never handle API keys.

## When to generate

- Only when the person asks for images, photos or illustrations. Generation costs them money or GPU time.
- Otherwise use shapes, gradients, SVG line art or the images they gave you.
- One or two strong images beat a grid of generic ones. Decide what each image is for before you write a prompt.

## How

Use a `gen://` URL wherever an image URL goes. It works in `write_html`, `update_styles` and `create_artboard`:

```html
<img layer-name="Vase photo" src="gen://image?prompt=Hand-thrown%20stoneware%20vase%20on%20raw%20linen%2C%20soft%20north%20light&w=800&h=1000" style="width: 400px; height: 500px; object-fit: cover" />
```

```json
{ "backgroundImage": "url(gen://image?prompt=Morning%20fog%20over%20a%20pine%20forest&w=1440&h=900)", "backgroundSize": "cover", "backgroundPosition": "center" }
```

Parameters, URL-encoded:
- `prompt` (required): what to make.
- `w`, `h`: the pixel size you want. Match the layer's aspect ratio; the layer keeps its own size.
- `model` (optional): a model id of the configured provider. Leave it out to use the user's default.
- `seed` (optional): for providers that support seeds, the same seed and prompt give a similar image.

`paper-gen://` works as an alias.

## What happens next

- The layer appears at once with a "Generating" marker on the canvas. The image fills in when the provider is done, usually within a few seconds to a minute. Your tool call does not wait for it.
- The prompt, model and seed are stored on the layer, so the user can regenerate or edit it from the inspector.
- If no provider is set up, or the provider fails, the layer shows the error on the canvas. Tell the user what to fix instead of retrying in a loop.
- Before you screenshot to review images, give them a moment. `get_node_info` shows an `asset://` source once an image is ready; while it still shows `gen://`, it is generating.

## Writing prompts

- Describe the subject, the setting, the light and the framing in plain words: "Close-up of a ceramic mug on a walnut desk, morning window light, shallow depth of field".
- Pull colours and mood from the design's brief so the image belongs to the page.
- Say "photo", "illustration", "3D render" or "flat vector" explicitly.
- Leave text out of images. Put words in real text layers on top.
- No real people's names, brands or logos unless the user provided them.
