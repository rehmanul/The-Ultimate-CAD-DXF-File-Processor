// Text Labels and Annotations for Floor Plans
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

export class TextLabels {
    constructor(renderer) {
        this.renderer = renderer;
        this.font = null;
        this.labelsGroup = new THREE.Group();
        this.renderer.scene.add(this.labelsGroup);
        this.loadFont();
    }
    
    loadFont() {
        const loader = new FontLoader();
        loader.load('./libs/package/examples/fonts/helvetiker_regular.typeface.json', (font) => {
            this.font = font;
        });
    }
    
    addIlotLabel(ilot, index) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(0, 0, 256, 128);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Ilot ${index + 1}`, 128, 50);
        ctx.font = '18px Arial';
        ctx.fillText(`${ilot.capacity || 'N/A'}`, 128, 85);
        
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
        sprite.position.set(ilot.x + ilot.width / 2, ilot.y + ilot.height / 2, 0.15);
        sprite.scale.set(3, 1.5, 1);
        sprite.userData = { type: 'label', ilotIndex: index };
        this.labelsGroup.add(sprite);
    }
    
    addDimensionLine(start, end, label) {
        const points = [
            new THREE.Vector3(start.x, start.y, 0),
            new THREE.Vector3(end.x, end.y, 0)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x000000 }));
        this.labelsGroup.add(line);
        
        const midpoint = new THREE.Vector3().addVectors(
            new THREE.Vector3(start.x, start.y, 0),
            new THREE.Vector3(end.x, end.y, 0)
        ).multiplyScalar(0.5);
        
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, 128, 40);
        
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
        sprite.position.copy(midpoint);
        sprite.scale.set(5, 1.25, 1);
        this.labelsGroup.add(sprite);
    }
    
    addRoomLabel(room, index) {
        if (!room.polygon || room.polygon.length === 0) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = 'black';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Room ${index + 1}`, 256, 50);
        ctx.font = '24px Arial';
        ctx.fillText(`${room.area?.toFixed(1) || 'N/A'} m²`, 256, 90);
        
        const texture = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
        
        let centerX, centerY;
        if (room.bounds) {
            centerX = (room.bounds.minX + room.bounds.maxX) / 2;
            centerY = (room.bounds.minY + room.bounds.maxY) / 2;
        } else {
            let sumX = 0, sumY = 0;
            room.polygon.forEach(pt => {
                sumX += Array.isArray(pt) ? pt[0] : pt.x;
                sumY += Array.isArray(pt) ? pt[1] : pt.y;
            });
            centerX = sumX / room.polygon.length;
            centerY = sumY / room.polygon.length;
        }
        
        sprite.position.set(centerX, centerY, 0.2);
        sprite.scale.set(10, 2.5, 1);
        this.labelsGroup.add(sprite);
    }
    
    clear() {
        this.labelsGroup.clear();
    }
    
    setVisible(visible) {
        this.labelsGroup.visible = visible;
        this.renderer.render();
    }
}
