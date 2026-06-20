/**
 * VoiceFeedback Plugin
 * 
 * A built-in middleware that uses the browser's Text-to-Speech (speechSynthesis)
 * API to provide audio confirmation after a voice command executes.
 * 
 * Usage:
 * app.use(voiceFeedback({ lang: 'en-US', volume: 0.8 }));
 */

export function voiceFeedback(options = {}) {
  return async (context, next) => {
    // Wait for the command to execute first
    await next();

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      return;
    }

    const { intent, payload } = context.result;
    let feedbackText = '';

    switch (intent) {
      case 'zoom_in':
        feedbackText = 'Zooming in.';
        break;
      case 'zoom_out':
        feedbackText = 'Zooming out.';
        break;
      case 'go_to':
        feedbackText = `Navigating to ${payload.place || 'location'}.`;
        break;
      case 'add_marker':
        feedbackText = 'Marker added.';
        break;
      case 'show_layer':
        feedbackText = `Showing ${payload.alias || payload.layerId} layer.`;
        break;
      case 'hide_layer':
        feedbackText = `Hiding ${payload.alias || payload.layerId} layer.`;
        break;
      case 'switch_map':
        feedbackText = `Switching map engine.`;
        break;
      case 'reset_view':
        feedbackText = 'View reset.';
        break;
      case 'undo':
        feedbackText = 'Undoing last action.';
        break;
      case 'redo':
        feedbackText = 'Redoing action.';
        break;
    }

    // Allow custom override mapper
    if (options.mapper && typeof options.mapper === 'function') {
      const customText = options.mapper(context.result);
      if (customText !== undefined) feedbackText = customText;
    }

    if (feedbackText) {
      // Cancel any currently playing speech to avoid overlapping
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(feedbackText);
      utterance.lang = options.lang || 'en-US';
      utterance.volume = options.volume !== undefined ? options.volume : 1.0;
      utterance.rate = options.rate || 1.1; // Slightly faster sounds better
      utterance.pitch = options.pitch || 1.0;
      
      window.speechSynthesis.speak(utterance);
    }
  };
}
