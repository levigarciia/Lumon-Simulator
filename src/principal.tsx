import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Aplicativo } from './Aplicativo';
import './tailwind.css';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento raiz ausente.');
createRoot(raiz).render(
    <StrictMode>
        <Aplicativo />
    </StrictMode>,
);
