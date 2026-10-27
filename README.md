# Semáforo de Ruido - Aula Digital (React + TypeScript)

Aplicación web interactiva para control acústico, moderación de ruido y fomento de la convivencia en aulas de Educación Primaria e Infantil.

## 🚀 Características

- **Monitor Acústico en Tiempo Real**: Análisis continuo con Web Audio API (RMS y suavizado exponencial).
- **Semáforo Escolar Visual**:
  - 🟢 **Verde** (😊): *Ambiente Perfecto* - Trabajo óptimo y relajado.
  - 🟡 **Amarillo** (👂): *Cuidado con el Murmullo* - Advertencia visual amigable.
  - 🔴 **Rojo** (🤫): *¡Demasiado Ruido!* - Alerta pulsante, contador de avisos y bip sonoro suave opcional.
- **3 Modos de Visualización**:
  - **Clásico**: Semáforo con luces brillantes e iconos reconocibles.
  - **Mascota de Aula (Búho Guardián)**: Mascota animada perfecta para los más pequeños.
  - **Medidor Grande (VU-Meter)**: Dial de decibelios relativos ideal para proyectores y pizarras digitales.
- **Calibración y Ajustes Personalizados**:
  - Ganancia del micrófono (0.5x - 4.0x).
  - Umbral de murmullo y umbral de ruido excesivo con validación entrelazada.
  - Aviso sonoro sutil personalizable y botón de prueba.
  - Presets rápidos: *Examen/Silencio*, *Trabajo Individual*, *Trabajo en Grupos*, *Asamblea/Debate*.
- **Métricas de Convivencia y Gamificación**:
  - Porcentaje de tiempo en silencio/óptimo durante la sesión.
  - Botón de felicitación con lluvia de confeti al cumplir los objetivos.
- **Soporte PWA y Modo Pantalla Completa**:
  - Prevención de suspensión de pantalla (*Screen Wake Lock API*).
  - Apta para tablets, móviles y pizarras digitales interactivas (PDI).

## 🛠️ Tecnologías

- **React 19** + **TypeScript**
- **Vite 6** + **Tailwind CSS v4**
- **Web Audio API** (analizador en tiempo real sin dependencias externas pesadas)
- **Lucide Icons** & **Canvas Confetti**
