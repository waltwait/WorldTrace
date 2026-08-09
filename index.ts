import { registerRootComponent } from 'expo';

// Imported first, and for its side effect: the background location task must
// be defined before React renders, so that a cold start triggered by the OS
// finds a handler registered.
import './src/capture/backgroundTask';

import App from './App';

registerRootComponent(App);
