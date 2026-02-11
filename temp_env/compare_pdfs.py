import fitz
import re

# Load both PDFs
generated = fitz.open('../Samples/Test2_Output/Test2_layout.pdf')
reference = fitz.open('../Samples/Final.pdf')

print('='*70)
print('PDF COMPARISON ANALYSIS')
print('='*70)

# Basic metadata
print('\n[1. PAGE METADATA]')
print(f'Generated PDF: {len(generated)} page(s)')
print(f'Reference PDF: {len(reference)} page(s)')

gen_page = generated[0]
ref_page = reference[0]

print(f'\nGenerated page size: {gen_page.rect.width:.2f} x {gen_page.rect.height:.2f} pts')
print(f'Reference page size: {ref_page.rect.width:.2f} x {ref_page.rect.height:.2f} pts')

# Extract text content
print('\n[2. TEXT CONTENT COMPARISON]')
gen_text = gen_page.get_text()
ref_text = ref_page.get_text()

print(f'Generated text length: {len(gen_text)} chars')
print(f'Reference text length: {len(ref_text)} chars')

# Check for key elements
key_elements = ['COSTO', 'PLAN', 'ETAGE', '1-200', 'Tôle Blanche', 'Radiateur', 'm²']
print('\n[3. KEY ELEMENTS CHECK]')
for elem in key_elements:
    gen_has = elem in gen_text
    ref_has = elem in ref_text
    status = 'OK' if gen_has == ref_has else 'DIFF'
    print(f'  {status} "{elem}": Generated={gen_has}, Reference={ref_has}')

# Count box numbers pattern
gen_numbers = re.findall(r'\b(\d{3})\b', gen_text)
ref_numbers = re.findall(r'\b(\d{3})\b', ref_text)

print(f'\n[4. BOX NUMBERS]')
if gen_numbers:
    print(f'Generated 3-digit numbers: {len(gen_numbers)} (range: {min(gen_numbers)}-{max(gen_numbers)})')
else:
    print(f'Generated 3-digit numbers: 0')
    
if ref_numbers:
    print(f'Reference 3-digit numbers: {len(ref_numbers)} (range: {min(ref_numbers)}-{max(ref_numbers)})')
else:
    print(f'Reference 3-digit numbers: 0')

# Render to images for visual comparison
print('\n[5. RENDERING TO IMAGES...]')
mat = fitz.Matrix(1, 1)  # 1x scale for comparison
gen_pix = gen_page.get_pixmap(matrix=mat)
ref_pix = ref_page.get_pixmap(matrix=mat)

# Save images
gen_pix.save('generated.png')
ref_pix.save('reference.png')

print(f'Generated image: {gen_pix.width} x {gen_pix.height}')
print(f'Reference image: {ref_pix.width} x {ref_pix.height}')

# Pixel-level color analysis
print('\n[6. PIXEL COLOR ANALYSIS]')
gen_samples = gen_pix.samples
ref_samples = ref_pix.samples

# Count pixels by color category
def analyze_colors(samples, width, height):
    green_pixels = 0
    blue_pixels = 0
    red_pixels = 0
    black_pixels = 0
    white_pixels = 0
    total = len(samples) // 3
    
    for i in range(0, len(samples), 3):
        r, g, b = samples[i], samples[i+1], samples[i+2]
        
        # Green (border)
        if g > 150 and r < 100 and b < 100:
            green_pixels += 1
        # Blue (boxes)
        elif b > 150 and r < 100 and g < 100:
            blue_pixels += 1
        # Red (radiators)
        elif r > 150 and g < 100 and b < 100:
            red_pixels += 1
        # Black (text/lines)
        elif r < 50 and g < 50 and b < 50:
            black_pixels += 1
        # White (background)
        elif r > 200 and g > 200 and b > 200:
            white_pixels += 1
    
    return {
        'green': green_pixels,
        'blue': blue_pixels,
        'red': red_pixels,
        'black': black_pixels,
        'white': white_pixels,
        'total': total
    }

gen_colors = analyze_colors(gen_samples, gen_pix.width, gen_pix.height)
ref_colors = analyze_colors(ref_samples, ref_pix.width, ref_pix.height)

print(f'\nGenerated color distribution:')
print(f'  Green (border): {gen_colors["green"]} pixels ({gen_colors["green"]/gen_colors["total"]*100:.2f}%)')
print(f'  Blue (boxes): {gen_colors["blue"]} pixels ({gen_colors["blue"]/gen_colors["total"]*100:.2f}%)')
print(f'  Red (radiators): {gen_colors["red"]} pixels ({gen_colors["red"]/gen_colors["total"]*100:.2f}%)')
print(f'  Black (text/lines): {gen_colors["black"]} pixels ({gen_colors["black"]/gen_colors["total"]*100:.2f}%)')
print(f'  White (background): {gen_colors["white"]} pixels ({gen_colors["white"]/gen_colors["total"]*100:.2f}%)')

print(f'\nReference color distribution:')
print(f'  Green (border): {ref_colors["green"]} pixels ({ref_colors["green"]/ref_colors["total"]*100:.2f}%)')
print(f'  Blue (boxes): {ref_colors["blue"]} pixels ({ref_colors["blue"]/ref_colors["total"]*100:.2f}%)')
print(f'  Red (radiators): {ref_colors["red"]} pixels ({ref_colors["red"]/ref_colors["total"]*100:.2f}%)')
print(f'  Black (text/lines): {ref_colors["black"]} pixels ({ref_colors["black"]/ref_colors["total"]*100:.2f}%)')
print(f'  White (background): {ref_colors["white"]} pixels ({ref_colors["white"]/ref_colors["total"]*100:.2f}%)')

# Detailed pixel comparison summary
print('\n[7. STRUCTURAL COMPARISON]')

# Check dimensions ratio
gen_ratio = gen_pix.width / gen_pix.height
ref_ratio = ref_pix.width / ref_pix.height
print(f'\nAspect ratio:')
print(f'  Generated: {gen_ratio:.3f}')
print(f'  Reference: {ref_ratio:.3f}')
print(f'  Match: {"OK" if abs(gen_ratio - ref_ratio) < 0.1 else "DIFF"}')

# Overall similarity score
print('\n' + '='*70)
print('SUMMARY')
print('='*70)

matches = 0
total_checks = 8

# Check 1: Page count
if len(generated) == len(reference):
    matches += 1
    print('OK Page count: MATCH')
else:
    print(f'X Page count: DIFFERENT (Generated={len(generated)}, Reference={len(reference)})')

# Check 2: Aspect ratio
if abs(gen_ratio - ref_ratio) < 0.1:
    matches += 1
    print('OK Aspect ratio: MATCH')
else:
    print('X Aspect ratio: DIFFERENT')

# Check 3: Box numbers
if len(gen_numbers) > 100 and len(ref_numbers) > 100:
    matches += 1
    print(f'OK Box numbers: BOTH HAVE ({len(gen_numbers)} vs {len(ref_numbers)})')
else:
    print(f'X Box numbers: INSUFFICIENT (Generated={len(gen_numbers)}, Reference={len(ref_numbers)})')

# Check 4: Green border
if gen_colors['green'] > 1000:
    matches += 1
    print('OK Green border: GENERATED HAS')
else:
    print('X Green border: MISSING OR TOO SMALL')

# Check 5: Blue boxes
if gen_colors['blue'] > 10000:
    matches += 1
    print('OK Blue boxes (Tôle Grise): GENERATED HAS')
else:
    print('X Blue boxes (Tôle Grise): MISSING OR TOO SMALL')

# Check 6: Red radiators
if gen_colors['red'] > 1000:
    matches += 1
    print('OK Red radiators: GENERATED HAS')
else:
    print('X Red radiators: MISSING OR TOO SMALL')

# Check 7: COSTO branding
if 'COSTO' in gen_text:
    matches += 1
    print('OK COSTO branding: PRESENT')
else:
    print('X COSTO branding: MISSING')

# Check 8: Area labels (m²)
if gen_text.count('m²') > 50:
    matches += 1
    print(f'OK Area labels (m²): PRESENT ({gen_text.count("m²")} occurrences)')
else:
    print(f'X Area labels (m²): INSUFFICIENT ({gen_text.count("m²")} occurrences)')

print(f'\nSIMILARITY SCORE: {matches}/{total_checks} ({matches/total_checks*100:.1f}%)')

if matches >= 7:
    print('\n*** VERDICT: OUTPUT MATCHES REFERENCE QUALITY ***')
elif matches >= 5:
    print('\n~ VERDICT: OUTPUT IS CLOSE TO REFERENCE ~')
else:
    print('\n!!! VERDICT: OUTPUT DIFFERS SIGNIFICANTLY FROM REFERENCE !!!')

generated.close()
reference.close()
