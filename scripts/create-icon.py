from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'build'
out.mkdir(exist_ok=True)
source = out / 'irwin-mango-source.png'
if not source.exists():
    raise FileNotFoundError(f'Missing generated icon source: {source}')

mango = Image.open(source).convert('RGBA')
mango.thumbnail((900, 900), Image.Resampling.LANCZOS)
icon = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
icon.alpha_composite(
    mango,
    ((icon.width - mango.width) // 2, (icon.height - mango.height) // 2),
)
icon.save(out / 'icon.png')
icon.save(out / 'icon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
icon.save(out / 'icon.icns')
