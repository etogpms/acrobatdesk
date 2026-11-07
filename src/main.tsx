import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Interface and handwriting fonts are bundled (no Google Fonts request)
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/caveat/600.css';
import '@fontsource/caveat/700.css';
import '@fontsource/dancing-script/600.css';
import '@fontsource/dancing-script/700.css';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
