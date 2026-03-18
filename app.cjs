// Este arquivo serve como uma "ponte" para o painel de hospedagem (cPanel/Passenger)
// Ele permite que o servidor carregue nosso projeto moderno (ES Module) usando o padrão antigo (CommonJS)
import('./server.js').catch(err => {
    console.error("Erro ao iniciar o servidor:", err);
    process.exit(1);
});
