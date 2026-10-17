import { useEffect, useState } from 'react';
import type { EstadoMotor } from '../../shared/modelos';
import { lumon } from '../services/ponte';

/** Mostra preparação e backend reais enquanto os funcionários usam o motor local. */
export function EstadoMotorLocal() {
    const [estado, setEstado] = useState<EstadoMotor>();
    useEffect(() => {
        const remover = lumon?.aoEvento((evento) => {
            if (evento.tipo === 'motor') setEstado(evento.estado);
        });
        if (typeof lumon?.obterMotor === 'function') {
            void lumon.obterMotor().then(setEstado).catch(() => {});
        }
        return remover;
    }, []);
    if (!estado || estado.fase === 'desligado') return null;
    const progresso = estado.progresso === undefined ? '' : ` (${Math.round(estado.progresso)}%)`;
    return (
        <div role="status" className="pointer-events-auto max-w-lg rounded-lg border border-borda
            bg-superficie/95 px-3 py-2 text-[12px] text-secundario" title={estado.dispositivo}>
            {estado.fase === 'erro' ? 'Motor local: ' : ''}{estado.detalhe.slice(0, 180)}{progresso}
            {estado.backend && <span className="ml-2 text-discreto">{estado.backend.toUpperCase()}</span>}
        </div>
    );
}
