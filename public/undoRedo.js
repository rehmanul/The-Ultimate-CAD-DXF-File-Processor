// Undo/Redo System with Command Pattern
export class UndoRedoManager {
    constructor() {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistory = 50;
    }
    
    execute(command) {
        command.execute();
        this.addToHistory(command);
    }
    
    addToHistory(command) {
        // Clear any redo history
        this.history = this.history.slice(0, this.currentIndex + 1);
        this.history.push(command);
        
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
    }
    
    undo() {
        if (!this.canUndo()) return false;
        
        const command = this.history[this.currentIndex];
        command.undo();
        this.currentIndex--;
        return true;
    }
    
    redo() {
        if (!this.canRedo()) return false;
        
        this.currentIndex++;
        const command = this.history[this.currentIndex];
        command.execute();
        return true;
    }
    
    canUndo() {
        return this.currentIndex >= 0;
    }
    
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }
    
    clear() {
        this.history = [];
        this.currentIndex = -1;
    }
}

export class MoveIlotCommand {
    constructor(ilot, oldPos, newPos, onUpdate) {
        this.ilot = ilot;
        this.oldPos = oldPos;
        this.newPos = newPos;
        this.onUpdate = onUpdate;
    }
    
    execute() {
        this.ilot.x = this.newPos.x;
        this.ilot.y = this.newPos.y;
        if (this.onUpdate) this.onUpdate();
    }
    
    undo() {
        this.ilot.x = this.oldPos.x;
        this.ilot.y = this.oldPos.y;
        if (this.onUpdate) this.onUpdate();
    }
}

export class DeleteIlotCommand {
    constructor(ilots, index, onUpdate) {
        this.ilots = ilots;
        this.index = index;
        this.deletedIlot = null;
        this.onUpdate = onUpdate;
    }
    
    execute() {
        this.deletedIlot = this.ilots.splice(this.index, 1)[0];
        if (this.onUpdate) this.onUpdate();
    }
    
    undo() {
        this.ilots.splice(this.index, 0, this.deletedIlot);
        if (this.onUpdate) this.onUpdate();
    }
}

export class AddIlotCommand {
    constructor(ilots, ilot, onUpdate) {
        this.ilots = ilots;
        this.ilot = ilot;
        this.onUpdate = onUpdate;
    }
    
    execute() {
        this.ilots.push(this.ilot);
        if (this.onUpdate) this.onUpdate();
    }
    
    undo() {
        this.ilots.pop();
        if (this.onUpdate) this.onUpdate();
    }
}

export class ResizeIlotCommand {
    constructor(ilot, oldSize, newSize, onUpdate) {
        this.ilot = ilot;
        this.oldSize = oldSize;
        this.newSize = newSize;
        this.onUpdate = onUpdate;
    }
    
    execute() {
        this.ilot.width = this.newSize.width;
        this.ilot.height = this.newSize.height;
        if (this.onUpdate) this.onUpdate();
    }
    
    undo() {
        this.ilot.width = this.oldSize.width;
        this.ilot.height = this.oldSize.height;
        if (this.onUpdate) this.onUpdate();
    }
}

export class TransformIlotCommand {
    constructor(ilot, oldState, newState, onUpdate) {
        this.ilot = ilot;
        this.oldState = oldState;
        this.newState = newState;
        this.onUpdate = onUpdate;
    }
    
    execute() {
        this.ilot.x = this.newState.x;
        this.ilot.y = this.newState.y;
        this.ilot.width = this.newState.width;
        this.ilot.height = this.newState.height;
        if (this.onUpdate) this.onUpdate();
    }
    
    undo() {
        this.ilot.x = this.oldState.x;
        this.ilot.y = this.oldState.y;
        this.ilot.width = this.oldState.width;
        this.ilot.height = this.oldState.height;
        if (this.onUpdate) this.onUpdate();
    }
}
