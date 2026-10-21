import os
from fontTools.ttLib import TTFont
from fontTools import subset
d = r'C:\Users\shinn\AppData\Local\Microsoft\Windows\Fonts'
src = os.path.join(d, [f for f in os.listdir(d) if f.startswith('J028')][0])
f = TTFont(src)
for t in ('gasp','mort','LTSH','hdmx','VDMX','DSIG','PCLT'):
    if t in f: del f[t]
tmp = r'C:\Users\shinn\AppData\Local\Temp\oohige-clean.ttf'
f.save(tmp)

text = 'フルコンボ全良不可無しドンカ大髭ミスなしFULCOMBAJSTERPDKN0123456789'
opt = subset.Options()
opt.flavor = 'woff2'
opt.desubroutinize = True
opt.layout_features = ['*']
opt.name_IDs = ['*']
opt.notdef_outline = True
font = subset.load_font(tmp, opt)
s = subset.Subsetter(options=opt)
s.populate(text=text)
s.subset(font)
out = r'C:\mvbeat\assets\fonts\oohige-sub.woff2'
subset.save_font(font, out, opt)
print('wrote', out, os.path.getsize(out), 'bytes')
