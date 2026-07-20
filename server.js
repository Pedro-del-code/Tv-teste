// Servidor simples só para servir os arquivos estáticos (html/css/js).
// Toda a lógica de controle da TV roda no navegador do usuário, não aqui —
// o servidor nunca fala com a TV, pois a TV está na rede local do usuário,
// não na rede do Render.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Controle Remoto Web rodando na porta ${PORT}`);
});
