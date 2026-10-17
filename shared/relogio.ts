const inicioExpedienteMinutos = 9 * 60;
const duracaoExpedienteMinutos = 9 * 60;

/** Quantos minutos do relógio do escritório passam a cada segundo de simulação. */
export const minutosPorSegundo = 1;

/** Dia e hora do escritório para um instante da simulação. O expediente vai das 09:00 às 18:00. */
export function lerRelogio(segundos: number): { dia: number; hora: string } {
    const minutos = Math.floor(segundos * minutosPorSegundo);
    const dia = Math.floor(minutos / duracaoExpedienteMinutos) + 1;
    const minutoDoDia = inicioExpedienteMinutos + (minutos % duracaoExpedienteMinutos);
    const hora = `${String(Math.floor(minutoDoDia / 60)).padStart(2, '0')}:${String(minutoDoDia % 60).padStart(2, '0')}`;
    return { dia, hora };
}
