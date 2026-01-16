import ezdxf
from typing import List, Optional, Dict

class DXFProcessor:
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.doc = None
        self.msp = None

    def load(self):
        try:
            self.doc = ezdxf.readfile(self.filepath)
            self.msp = self.doc.modelspace()
        except IOError:
            raise Exception(f"Not a DXF file or a generic I/O error: {self.filepath}")
        except ezdxf.DXFStructureError:
            raise Exception(f"Invalid or corrupted DXF file: {self.filepath}")

    def get_entities(self, layer: str = None, dxftype: str = None):
        if not self.msp:
            return []

        query = '*'
        if layer:
            # ezdxf query string format is slightly different, let's keep it simple
            # We will iterate if query is complex, but ezdxf supports attribute queries
            pass

        # Simple manual filtering
        entities = self.msp
        if layer:
            entities = [e for e in entities if e.dxf.layer == layer]

        if dxftype:
            entities = [e for e in entities if e.dxftype() == dxftype]

        return entities

    def get_layers(self) -> List[str]:
        if not self.doc:
            return []
        return [layer.dxf.name for layer in self.doc.layers]
