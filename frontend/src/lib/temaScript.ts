/** A chave do tema guardado neste navegador (13/10/2026; ver lib/tema.ts). */
export const CHAVE_TEMA = "sig.tema";

/** A chave do zoom guardado neste navegador (18/11/2026; ver lib/zoom.ts). */
export const CHAVE_ZOOM = "sig.zoom";

/**
 * O script que aplica o tema e o zoom guardados antes de a página aparecer (no <head> do layout), para não piscar o Padrão
 * (o zoom desde 18/11/2026).
 */
export const SCRIPT_DO_TEMA = `try{var t=localStorage.getItem("${CHAVE_TEMA}");if(t==="claro"||t==="escuro"){document.documentElement.dataset.tema=t;if(t==="escuro")document.documentElement.classList.add("dark")}var z=localStorage.getItem("${CHAVE_ZOOM}");if(z==="85"||z==="125")document.documentElement.dataset.zoom=z}catch(e){}`;
