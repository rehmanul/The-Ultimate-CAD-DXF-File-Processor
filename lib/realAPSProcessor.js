const axios = require('axios');

class RealAPSProcessor {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.baseUrl = 'https://developer.api.autodesk.com';
        this.token = null;
        this.tokenExpiry = null;
    }

    async getToken() {
        if (this.token && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.token;
        }

        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('grant_type', 'client_credentials');
        params.append('scope', 'data:read viewables:read');

        const response = await axios.post(`${this.baseUrl}/authentication/v2/token`, params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        this.token = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;

        return this.token;
    }

    async extractGeometry(urn) {
        const token = await this.getToken();

        // Get manifest
        const manifestResponse = await axios.get(
            `${this.baseUrl}/modelderivative/v2/designdata/${urn}/manifest`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (manifestResponse.data.status !== 'success') {
            throw new Error('APS_NOT_READY');
        }

        // Get metadata
        const metadataResponse = await axios.get(
            `${this.baseUrl}/modelderivative/v2/designdata/${urn}/metadata`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        const guid = metadataResponse.data.data?.metadata?.[0]?.guid;
        if (!guid) {
            throw new Error('No geometry metadata available');
        }

        // Get properties
        const propertiesResponse = await axios.get(
            `${this.baseUrl}/modelderivative/v2/designdata/${urn}/metadata/${guid}/properties`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        // Enhanced extraction: parse nested objects and filter relevant geometry
        const collection = propertiesResponse.data.data?.collection || [];
        const walls = [];
        const forbiddenZones = [];
        const entrances = [];

        // Heuristic parser: some APS property sets include numeric fields like StartX/StartY/EndX/EndY or X/Y; others may include nested arrays.
        const isNumber = v => (v !== null && v !== undefined && !Number.isNaN(Number(v)));

        const tryParseCoords = (props) => {
            // Try common patterns
            const keys = Object.keys(props || {});
            const lower = k => k.toLowerCase();
            if (keys.some(k => /startx|start_x/i.test(k)) && keys.some(k => /starty|start_y/i.test(k)) && keys.some(k => /endx|end_x/i.test(k)) && keys.some(k => /endy|end_y/i.test(k))) {
                const sx = Number(props[keys.find(k => /startx|start_x/i.test(k))]);
                const sy = Number(props[keys.find(k => /starty|start_y/i.test(k))]);
                const ex = Number(props[keys.find(k => /endx|end_x/i.test(k))]);
                const ey = Number(props[keys.find(k => /endy|end_y/i.test(k))]);
                if ([sx, sy, ex, ey].every(n => isFinite(n))) return { start: { x: sx, y: sy }, end: { x: ex, y: ey } };
            }
            // simple X/Y pair
            if (keys.some(k => /^x$/i.test(k)) && keys.some(k => /^y$/i.test(k))) {
                const x = Number(props[keys.find(k => /^x$/i.test(k))]);
                const y = Number(props[keys.find(k => /^y$/i.test(k))]);
                if (isFinite(x) && isFinite(y)) return { point: { x, y } };
            }
            // try XY with suffixes
            const xk = keys.find(k => /(^|[^a-z])x($|[^a-z])/i.test(k) || /coordx|cx/i.test(k));
            const yk = keys.find(k => /(^|[^a-z])y($|[^a-z])/i.test(k) || /coordy|cy/i.test(k));
            if (xk && yk && isNumber(props[xk]) && isNumber(props[yk])) return { point: { x: Number(props[xk]), y: Number(props[yk]) } };

            // geometry arrays (vertices) often nested as arrays or JSON strings
            const vertKey = keys.find(k => /vert|vertex|points|coords|geometry/i.test(k));
            if (vertKey) {
                const raw = props[vertKey];
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    if (Array.isArray(parsed) && parsed.length >= 2 && Array.isArray(parsed[0])) {
                        // take first two points
                        const p0 = parsed[0];
                        const p1 = parsed[1];
                        if (p0.length >= 2 && p1.length >= 2) return { start: { x: Number(p0[0]), y: Number(p0[1]) }, end: { x: Number(p1[0]), y: Number(p1[1]) } };
                    }
                } catch (e) { /* ignore */ }
            }

            return null;
        };

        collection.forEach(item => {
            if (!item || !item.properties) return;
            const props = item.properties || {};
            const name = (item.name || '').toLowerCase();
            const category = (props.Category || '').toString().toLowerCase();

            // direct heuristics
            const parsed = tryParseCoords(props);
            if (parsed && parsed.start && parsed.end) {
                // classify by name/category hints
                if (category.includes('wall') || name.includes('wall')) {
                    walls.push({ start: parsed.start, end: parsed.end, layer: 'WALLS', raw: item });
                    return;
                }
                if (category.includes('door') || name.includes('door') || name.includes('entry') || name.includes('entrance')) {
                    entrances.push({ start: parsed.start, end: parsed.end, layer: 'ENTRANCE', raw: item });
                    return;
                }
                // default to wall-like
                walls.push({ start: parsed.start, end: parsed.end, layer: 'WALLS', raw: item });
                return;
            }

            if (parsed && parsed.point) {
                // point-like objects (furniture, fixtures) - skip for walls but may mark entrances
                if (category.includes('door') || name.includes('door') || name.includes('entry') || name.includes('entrance')) {
                    entrances.push({ start: parsed.point, end: { x: parsed.point.x + (props.Width || 1), y: parsed.point.y }, layer: 'ENTRANCE', raw: item });
                }
                return;
            }

            // fallback to original classification heuristics
            if (category.includes('wall') || name.includes('wall')) {
                const wall = this.extractWallGeometry(item);
                if (wall) walls.push(wall);
            } else if (category.includes('door') || category.includes('entrance') || name.includes('door') || name.includes('entrance')) {
                const entrance = this.extractEntranceGeometry(item);
                if (entrance) entrances.push(entrance);
            } else if (category.includes('stair') || category.includes('elevator') || category.includes('forbidden') || name.includes('stair') || name.includes('elevator') || name.includes('forbidden')) {
                const zone = this.extractForbiddenZoneGeometry(item);
                if (zone) forbiddenZones.push(zone);
            }
        });

        // Calculate bounds from extracted geometry
        let bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        const allPoints = [];

        walls.forEach(wall => {
            allPoints.push(wall.start, wall.end);
        });
        forbiddenZones.forEach(zone => {
            allPoints.push(zone.start, zone.end);
        });
        entrances.forEach(entrance => {
            allPoints.push(entrance.start, entrance.end);
        });

        if (allPoints.length > 0) {
            bounds = this.calculateBounds(allPoints);
        } else {
            bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        }

        const totalArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

        // Try to get placement transform or global offset information from the manifest or metadata
        let placementTransform = null;
        try {
            // Attempt to read a placementTransform from the manifest derivatives (some derivatives include this)
            const manifestDerivatives = manifestResponse.data.derivatives || [];
            for (const d of manifestDerivatives) {
                if (d.outputType === 'svf' || d.outputType === 'resource') {
                    if (d.properties && d.properties.placementTransform) {
                        placementTransform = d.properties.placementTransform;
                        break;
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        // Fallback: try to extract a global offset or placement info from the properties response
        try {
            const dataCollection = propertiesResponse.data.data || {};
            if (dataCollection && dataCollection.globalOffset) {
                placementTransform = dataCollection.globalOffset;
            } else if (dataCollection && dataCollection.placementTransform) {
                placementTransform = dataCollection.placementTransform;
            }
        } catch (e) { /* ignore */ }

        return {
            walls,
            forbiddenZones,
            entrances,
            bounds,
            totalArea,
            placementTransform
        };
    }

    processRealGeometry(data) {
        const walls = [];
        const forbiddenZones = [];
        const entrances = [];
        let bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

        if (data.data?.collection) {
            data.data.collection.forEach(item => {
                if (item.properties) {
                    // Extract real geometry based on APS object properties
                    const objectType = item.properties.Category || item.name || '';

                    if (objectType.toLowerCase().includes('wall')) {
                        // Process wall geometry
                        const wall = this.extractWallGeometry(item);
                        if (wall) walls.push(wall);
                    } else if (objectType.toLowerCase().includes('door') || objectType.toLowerCase().includes('entrance')) {
                        // Process entrance geometry
                        const entrance = this.extractEntranceGeometry(item);
                        if (entrance) entrances.push(entrance);
                    } else if (objectType.toLowerCase().includes('stair') || objectType.toLowerCase().includes('elevator')) {
                        // Process forbidden zone geometry
                        const zone = this.extractForbiddenZoneGeometry(item);
                        if (zone) forbiddenZones.push(zone);
                    }
                }
            });
        }

        // Calculate bounds from extracted geometry
        if (walls.length > 0) {
            const allPoints = walls.flatMap(wall => [wall.start, wall.end]);
            bounds = this.calculateBounds(allPoints);
        }

        const totalArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);

        return {
            walls,
            forbiddenZones,
            entrances,
            bounds,
            totalArea
        };
    }

    extractWallGeometry(item) {
        // Extract real wall coordinates from APS properties
        const props = item.properties;
        if (props.Length && props.Height) {
            return {
                start: { x: parseFloat(props.StartX) || 0, y: parseFloat(props.StartY) || 0 },
                end: { x: parseFloat(props.EndX) || parseFloat(props.Length) || 100, y: parseFloat(props.EndY) || 0 },
                layer: 'WALLS',
                color: 0
            };
        }
        return null;
    }

    extractEntranceGeometry(item) {
        const props = item.properties;
        if (props.Width) {
            return {
                start: { x: parseFloat(props.X) || 0, y: parseFloat(props.Y) || 0 },
                end: { x: parseFloat(props.X) + parseFloat(props.Width) || 50, y: parseFloat(props.Y) || 0 },
                layer: 'ENTRANCES',
                color: 1
            };
        }
        return null;
    }

    extractForbiddenZoneGeometry(item) {
        const props = item.properties;
        if (props.Area) {
            return {
                start: { x: parseFloat(props.X) || 0, y: parseFloat(props.Y) || 0 },
                end: { x: parseFloat(props.X) + 50 || 50, y: parseFloat(props.Y) + 50 || 50 },
                layer: 'FORBIDDEN',
                color: 5
            };
        }
        return null;
    }

    calculateBounds(points) {
        if (points.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };

        return {
            minX: Math.min(...points.map(p => p.x)),
            minY: Math.min(...points.map(p => p.y)),
            maxX: Math.max(...points.map(p => p.x)),
            maxY: Math.max(...points.map(p => p.y))
        };
    }
}

module.exports = RealAPSProcessor;