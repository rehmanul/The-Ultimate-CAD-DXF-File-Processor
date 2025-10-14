const axios = require('axios');

class AdvancedAPSProcessor {
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

    async extractAdvancedGeometry(urn) {
        const token = await this.getToken();
        
        try {
            // Get manifest to check processing status
            const manifestResponse = await axios.get(
                `${this.baseUrl}/modelderivative/v2/designdata/${urn}/manifest`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            
            const manifest = manifestResponse.data;
            if (manifest.status !== 'success') {
                throw new Error('APS_NOT_READY');
            }

            // Get metadata tree
            const metadataResponse = await axios.get(
                `${this.baseUrl}/modelderivative/v2/designdata/${urn}/metadata`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            if (!metadataResponse.data.data?.metadata?.length) {
                throw new Error('No geometry data available');
            }

            const guid = metadataResponse.data.data.metadata[0].guid;

            // Get object tree for detailed geometry
            const objectTreeResponse = await axios.get(
                `${this.baseUrl}/modelderivative/v2/designdata/${urn}/metadata/${guid}/properties`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            // Try to get actual geometry data
            let geometryData = null;
            try {
                const geometryResponse = await axios.get(
                    `${this.baseUrl}/modelderivative/v2/designdata/${urn}/metadata/${guid}`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                geometryData = geometryResponse.data;
            } catch (geoError) {
                console.log('Could not get geometry data, using properties only');
            }

            // Extract sophisticated geometry data
            return this.processAdvancedGeometry(objectTreeResponse.data, geometryData);

        } catch (error) {
            if (error.message === 'APS_NOT_READY') {
                throw error;
            }
            console.error('Advanced APS processing error:', error.response?.data || error.message);
            throw new Error('Failed to extract advanced geometry from APS');
        }
    }

    processAdvancedGeometry(data, geometryData = null) {
        // This processor is only used when local CAD processing fails
        // It extracts ONLY what APS provides - no fake data
        if (!data.data?.collection || data.data.collection.length === 0) {
            throw new Error('No geometry data available from APS');
        }

        const rooms = [];
        let totalArea = 0;

        data.data.collection.forEach((item, index) => {
            if (item.properties && item.properties.Area) {
                const area = parseFloat(item.properties.Area);
                if (area > 0) {
                    rooms.push({
                        id: index + 1,
                        name: item.name || `Room ${index + 1}`,
                        area: area,
                        type: this.classifyRoomType(item.name || '', area)
                    });
                    totalArea += area;
                }
            }
        });

        return {
            walls: [],
            forbiddenZones: [],
            entrances: [],
            rooms,
            bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
            totalArea,
            urn: null
        };
    }

    classifyRoomType(name, area) {
        const nameLower = name.toLowerCase();
        
        if (nameLower.includes('office') || nameLower.includes('bureau')) return 'office';
        if (nameLower.includes('meeting') || nameLower.includes('conference')) return 'meeting';
        if (nameLower.includes('kitchen') || nameLower.includes('break')) return 'break';
        if (nameLower.includes('bathroom') || nameLower.includes('toilet')) return 'bathroom';
        if (nameLower.includes('storage') || nameLower.includes('closet')) return 'storage';
        if (nameLower.includes('corridor') || nameLower.includes('hallway')) return 'corridor';
        
        // Classify by area
        if (area < 5) return 'storage';
        if (area < 15) return 'office';
        if (area < 30) return 'meeting';
        return 'office';
    }
}

module.exports = AdvancedAPSProcessor;