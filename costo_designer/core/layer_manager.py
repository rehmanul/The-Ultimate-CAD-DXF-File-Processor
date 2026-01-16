class LayerManager:
    def __init__(self, dxf_doc):
        self.dxf_doc = dxf_doc

    def is_visible(self, layer_name):
        # Placeholder logic: check if layer is frozen or off
        if self.dxf_doc and layer_name in self.dxf_doc.layers:
            layer = self.dxf_doc.layers.get(layer_name)
            return layer.is_on() and not layer.is_frozen()
        return True

    def get_layer_color(self, layer_name):
        if self.dxf_doc and layer_name in self.dxf_doc.layers:
            return self.dxf_doc.layers.get(layer_name).color
        return 7
