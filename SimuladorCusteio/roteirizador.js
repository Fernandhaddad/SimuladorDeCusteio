// =================================================================
// 1. INICIALIZAÇÃO DO MAPA E CAMADAS
// =================================================================

// Cria o mapa e o centraliza no Brasil. Esta é a linha que "cria" o mapa na tela.
const map = L.map('map').setView([-14.235, -51.925], 4);

// Adiciona o "fundo" do mapa (as imagens dos países, ruas, etc.)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Cria uma "camada" ou "grupo" no mapa para desenharmos a rota depois.
const routeLayer = L.layerGroup().addTo(map);

// =================================================================
// 2. FUNÇÕES DE API (Geocodificação e Rotas)
// Reutilizamos as mesmas funções da calculadora.
// =================================================================

/**
 * Converte um endereço de texto (ex: "Av. Paulista") em coordenadas (latitude, longitude).
 */
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
            return { lat: data[0].lat, lon: data[0].lon };
        } else {
            throw new Error(`Endereço não encontrado para: "${address}"`);
        }
    } catch (error) {
        console.error('Erro de geocodificação:', error);
        throw error;
    }
}

/**
 * Busca uma rota entre dois pontos usando a API do OSRM.
 */
async function fetchRoute(startCoords, endCoords) {
    const profile = 'driving'; // Perfil de rota para carros
    const coordsString = `${startCoords.lon},${startCoords.lat};${endCoords.lon},${endCoords.lat}`;
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();
        if (data.code !== 'Ok') {
            throw new Error(data.message || 'Não foi possível calcular a rota via OSRM.');
        }
        return data.routes[0]; // Retorna a primeira rota encontrada
    } catch (error) {
        console.error('Erro ao buscar rota no OSRM:', error);
        throw error;
    }
}

// =================================================================
// 3. FUNÇÃO PRINCIPAL DO ROTEIRIZADOR
// =================================================================

/**
 * Função principal que é chamada quando o botão "Criar Rota" é clicado.
 */
async function criarRotaNoMapa() {
    // 1. Limpa o mapa de rotas e resultados anteriores
    routeLayer.clearLayers();
    const infoRotaDiv = document.getElementById('info-rota');
    infoRotaDiv.innerHTML = 'Processando...';

    // 2. Pega os valores dos campos de endereço
    const saidaInput = document.getElementById('ponto-saida').value;
    const chegadaInput = document.getElementById('ponto-chegada').value;

    if (!saidaInput || !chegadaInput) {
        alert('Por favor, preencha os endereços de saída e chegada.');
        infoRotaDiv.innerHTML = '';
        return;
    }

    try {
        // 3. Converte os endereços em coordenadas
        const saidaCoords = await geocodeAddress(saidaInput);
        const chegadaCoords = await geocodeAddress(chegadaInput);

        // 4. Busca a rota entre as coordenadas
        const rota = await fetchRoute(saidaCoords, chegadaCoords);

        // 5. Extrai informações da rota (distância e duração)
        const distanciaKm = (rota.distance / 1000).toFixed(2);
        const duracaoSegundos = rota.duration;
        
        // Função simples para formatar a duração
        const formatarDuracao = (seg) => {
            const horas = Math.floor(seg / 3600);
            const minutos = Math.floor((seg % 3600) / 60);
            return `${horas}h ${minutos}min`;
        };

        // 6. Mostra as informações na tela
        infoRotaDiv.innerHTML = `
            <div class="resultado-bloco">
                <strong>Distância Total:</strong> ${distanciaKm} km
            </div>
            <div class="resultado-bloco">
                <strong>Tempo Estimado:</strong> ${formatarDuracao(duracaoSegundos)}
            </div>
        `;

        // 7. Desenha a rota e os marcadores no mapa
        const routeLine = L.geoJSON(rota.geometry, { style: { color: '#0056b3', weight: 6 } });
        routeLayer.addLayer(routeLine);

        L.marker([saidaCoords.lat, saidaCoords.lon]).addTo(routeLayer).bindPopup(`<b>Saída:</b><br>${saidaInput}`);
        L.marker([chegadaCoords.lat, chegadaCoords.lon]).addTo(routeLayer).bindPopup(`<b>Chegada:</b><br>${chegadaInput}`);

        // 8. Ajusta o zoom do mapa para mostrar a rota inteira
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        alert('Falha ao criar a rota: ' + error.message);
        infoRotaDiv.innerHTML = 'Não foi possível gerar a rota. Verifique os endereços.';
    }
}

// =================================================================
// 4. EVENT LISTENER (Ponto de Entrada da Página)
// =================================================================

// Conecta a função 'criarRotaNoMapa' ao clique do botão 'criar-rota'
document.getElementById('criar-rota').addEventListener('click', criarRotaNoMapa);