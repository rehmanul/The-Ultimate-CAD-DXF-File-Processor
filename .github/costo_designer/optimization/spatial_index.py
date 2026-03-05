import rtree

class SpatialIndex:
    def __init__(self):
        self.idx = rtree.index.Index()

    def insert(self, id, bounds):
        self.idx.insert(id, bounds)

    def query(self, bounds):
        return list(self.idx.intersection(bounds))

    def delete(self, id, bounds):
        self.idx.delete(id, bounds)
