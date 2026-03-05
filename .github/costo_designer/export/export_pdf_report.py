from reportlab.pdfgen import canvas

class PDFExporter:
    def export(self, solution, filepath):
        c = canvas.Canvas(filepath)
        c.drawString(100, 750, "COSTO Project Report")
        c.save()
