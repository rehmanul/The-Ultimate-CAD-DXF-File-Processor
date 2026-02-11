import fitz
import re

print('='*70)
print('MULTI-FLOOR OUTPUT VERIFICATION')
print('='*70)

doc = fitz.open('../Samples/Test2_Output_MultiFloor/Test2_MultiFloor.pdf')
print(f'Pages: {len(doc)}')

page = doc[0]
print(f'Page size: {page.rect.width:.0f} x {page.rect.height:.0f} pts')

# Check text
text = page.get_text()
print(f'\nText content:')
print(f'  - PLAN ETAGE: {"PLAN ETAGE" in text}')
print(f'  - COSTO: {"COSTO" in text}')
print(f'  - 1-200: {"1-200" in text}')

# Count box numbers
numbers = re.findall(r'\b(\d{3})\b', text)
print(f'  - 3-digit numbers: {len(numbers)} (range: {min(numbers)}-{max(numbers)})')

# Render to image
pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5))
pix.save('multifloor_output.png')
print(f'\nSaved: multifloor_output.png ({pix.width} x {pix.height})')

# Color analysis
gen_samples = pix.samples
green = blue = red = 0
for i in range(0, len(gen_samples), 3):
    r, g, b = gen_samples[i], gen_samples[i+1], gen_samples[i+2]
    if g > 150 and r < 100 and b < 100:
        green += 1
    elif b > 150 and r < 100 and g < 100:
        blue += 1
    elif r > 150 and g < 100 and b < 100:
        red += 1

total = len(gen_samples) // 3
print(f'\nColor analysis:')
print(f'  - Green (border): {green} px ({green/total*100:.2f}%)')
print(f'  - Blue (boxes): {blue} px ({blue/total*100:.2f}%)')
print(f'  - Red (radiators): {red} px ({red/total*100:.2f}%)')

doc.close()
print('\n' + '='*70)
print('STYLING: Multi-floor output with 2 floors (Etage 01 + 02)')
print('='*70)
