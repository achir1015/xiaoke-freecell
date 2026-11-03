# 產生程式圖示：小柯機器人＋新接龍的紅黑交錯牌列（K♠ Q♥ J♣ 10♦）
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def font(size):
    for f in ('C:/Windows/Fonts/timesbd.ttf', 'C:/Windows/Fonts/arialbd.ttf', '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def sym(size):
    for f in ('C:/Windows/Fonts/seguisym.ttf', '/System/Library/Fonts/Apple Symbols.ttf'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def card(rank, suit, color, angle, cx, cy):
    w, h = 360, 500
    c = Image.new('RGBA', (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((20, 20, 20 + w, 20 + h), 40, fill=(254, 252, 244, 255), outline=(150, 140, 120, 255), width=6)
    d.text((48, 26), rank, font=font(118 if len(rank) == 1 else 96), fill=color)
    d.text((150 if len(rank) == 1 else 176, 36), suit, font=sym(104), fill=color)
    d.text((20 + w / 2, 20 + h / 2 + 70), suit, font=sym(250), fill=color, anchor='mm')
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh.paste(c, (cx - c.width // 2, cy - c.height // 2), c)
    return sh.rotate(angle, resample=Image.BICUBIC, center=(cx, cy))


img = layer()
# 圓角綠底牌桌
bg = layer()
d = ImageDraw.Draw(bg)
d.rounded_rectangle((36, 36, 988, 988), 190, fill=(92, 56, 28, 255))
d.rounded_rectangle((70, 70, 954, 954), 164, fill=(22, 112, 74, 255))
img = Image.alpha_composite(img, bg)

# 新接龍牌列：紅黑交錯、由大到小往下疊
BLACK, RED = (20, 24, 36, 255), (204, 24, 44, 255)
for i, (rk, su, col) in enumerate([('K', '♠', BLACK), ('Q', '♥', RED), ('J', '♣', BLACK), ('10', '♦', RED)]):
    c = card(rk, su, col, 4 - i * 2, 330 + i * 34, 330 + i * 118)
    shade = c.split()[3].filter(ImageFilter.GaussianBlur(14)).point(lambda p: p * 0.45)
    img = Image.alpha_composite(img, Image.merge('RGBA', (*[Image.new('L', (S, S), 0)] * 3, shade)))
    img = Image.alpha_composite(img, c)

# 右上角：回收座的四張 A（小圓牌）
for i, (su, col) in enumerate([('♠', BLACK), ('♥', RED), ('♦', RED), ('♣', BLACK)]):
    x, y = 640 + (i % 2) * 150, 150 + (i // 2) * 150
    t = layer()
    td = ImageDraw.Draw(t)
    td.rounded_rectangle((x - 60, y - 60, x + 60, y + 60), 24, fill=(254, 252, 244, 255), outline=(150, 140, 120, 255), width=4)
    td.text((x, y + 6), su, font=sym(96), fill=col, anchor='mm')
    img = Image.alpha_composite(img, t)

# 小柯機器人（頭盔造型）
rb = layer()
r = ImageDraw.Draw(rb)
cx, cy = 720, 730
r.line((cx, cy - 250, cx, cy - 190), fill=(90, 100, 120, 255), width=18)
r.ellipse((cx - 34, cy - 290, cx + 34, cy - 222), fill=(255, 196, 40, 255))
r.rounded_rectangle((cx - 262, cy - 70, cx - 210, cy + 80), 22, fill=(40, 120, 220, 255))
r.rounded_rectangle((cx + 210, cy - 70, cx + 262, cy + 80), 22, fill=(40, 120, 220, 255))
r.ellipse((cx - 230, cy - 210, cx + 230, cy + 220), fill=(70, 150, 240, 255))
r.ellipse((cx - 214, cy - 196, cx + 214, cy + 200), fill=(240, 246, 255, 255))
r.rounded_rectangle((cx - 170, cy - 110, cx + 170, cy + 90), 90, fill=(24, 36, 64, 255))
for ex in (cx - 72, cx + 72):
    r.arc((ex - 46, cy - 50, ex + 46, cy + 30), 200, 340, fill=(90, 230, 255, 255), width=22)
r.arc((cx - 50, cy + 10, cx + 50, cy + 70), 20, 160, fill=(90, 230, 255, 255), width=14)
r.ellipse((cx - 160, cy + 40, cx - 110, cy + 80), fill=(255, 140, 160, 200))
r.ellipse((cx + 110, cy + 40, cx + 160, cy + 80), fill=(255, 140, 160, 200))
sh2 = layer()
ImageDraw.Draw(sh2).ellipse((cx - 240, cy - 190, cx + 260, cy + 260), fill=(0, 0, 0, 130))
img = Image.alpha_composite(img, sh2.filter(ImageFilter.GaussianBlur(24)))
img = Image.alpha_composite(img, rb)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon ok')
