/**
 * CommandHistory.js
 * Tracks map state changes to allow voice-driven undo/redo functionality.
 */

export class CommandHistory {
  constructor(maxSize = 50) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Take a snapshot of the current map state.
   * @param {MapController} mapCtrl 
   */
  snapshot(mapCtrl) {
    if (!mapCtrl || !mapCtrl._adapter) return;
    
    try {
      const center = mapCtrl.getCenter();
      const zoom = mapCtrl.getZoom();
      
      const state = {
        center: [center.lat, center.lng],
        zoom: zoom
      };
      
      this.undoStack.push(state);
      
      // Keep within bounds
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
      
      // Clear redo stack on new action
      this.redoStack = [];
    } catch (err) {
      console.warn('[CommandHistory] Failed to take snapshot', err);
    }
  }

  /**
   * Restore the previous map state.
   * @param {MapController} mapCtrl 
   * @returns {boolean} True if undo was successful
   */
  undo(mapCtrl) {
    if (this.undoStack.length === 0) return false;
    if (!mapCtrl || !mapCtrl._adapter) return false;

    // Snapshot current state for redo
    const center = mapCtrl.getCenter();
    const zoom = mapCtrl.getZoom();
    this.redoStack.push({ center: [center.lat, center.lng], zoom });

    const previousState = this.undoStack.pop();
    mapCtrl.goTo(previousState.center, previousState.zoom, 'Undo');
    return true;
  }

  /**
   * Redo the previously undone map state.
   * @param {MapController} mapCtrl 
   * @returns {boolean} True if redo was successful
   */
  redo(mapCtrl) {
    if (this.redoStack.length === 0) return false;
    if (!mapCtrl || !mapCtrl._adapter) return false;

    // Snapshot current state for undo
    const center = mapCtrl.getCenter();
    const zoom = mapCtrl.getZoom();
    this.undoStack.push({ center: [center.lat, center.lng], zoom });

    const nextState = this.redoStack.pop();
    mapCtrl.goTo(nextState.center, nextState.zoom, 'Redo');
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
