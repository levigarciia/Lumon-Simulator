import type { ApiLumon } from '../shared/ponte';

declare global {
    interface Window {
        lumon?: ApiLumon;
    }
}
