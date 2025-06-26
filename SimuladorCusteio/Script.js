// --- Configuração Inicial do Mapa (sem alterações) ---
const map = L.map('map').setView([-14.235, -51.925], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);

// --- NOVAS FUNÇÕES AUXILIARES PARA CEP ---

/**
 * Verifica se uma string de entrada parece ser um CEP válido (8 dígitos).
 * @param {string} input - A string para verificar.
 * @returns {string|null} - Retorna o CEP limpo (só números) ou null.
 */
function getValidCep(input) {
    if (!input) return null;
    const cepLimpo = input.replace(/\D/g, ''); // Remove tudo que não for dígito
    return /^\d{8}$/.test(cepLimpo) ? cepLimpo : null;
}

/**
 * Busca um endereço completo usando a API ViaCEP.
 * @param {string} cep - O CEP de 8 dígitos.
 * @returns {string} - Uma string com o endereço formatado.
 */
async function fetchAddressFromCep(cep) {
    const url = `https://viacep.com.br/ws/${cep}/json/`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.erro) {
            throw new Error('CEP não encontrado.');
        }
        // Monta uma string de endereço otimizada para a busca por coordenadas
        return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`;
    } catch (error) {
        console.error('Erro ao buscar CEP:', error);
        throw error;
    }
}


// --- FUNÇÕES DE GEOLOCALIZAÇÃO E ROTA (com pequenas adaptações) ---

/**
 * Converte um endereço em coordenadas usando o Nominatim.
 * @param {string} address - O endereço completo.
 * @returns {object} - Um objeto com { lat, lon }.
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
 * Função principal, agora adaptada para lidar com CEPs.
 */
async function calculateAndDisplayRoute() {
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;

    if (!origemInput || !destinoInput) {
        alert('Por favor, preencha os campos de saída e chegada.');
        return;
    }
    
    document.getElementById('resultados').innerHTML = 'Processando endereços e calculando a rota...';

    try {
        // Função interna para processar cada input (seja CEP ou endereço)
        const processInput = async (input) => {
            const cep = getValidCep(input);
            if (cep) {
                // Se for um CEP, busca o endereço primeiro
                return await fetchAddressFromCep(cep);
            }
            // Se não, usa o input como está
            return input;
        };

        // Etapa 1: Obter os endereços completos (traduzindo CEPs se necessário)
        const [origemAddress, destinoAddress] = await Promise.all([
            processInput(origemInput),
            processInput(destinoInput)
        ]);

        // Etapa 2: Converter os endereços finais em coordenadas
        const [origemCoords, destinoCoords] = await Promise.all([
            geocodeAddress(origemAddress),
            geocodeAddress(destinoAddress)
        ]);

        // Etapa 3: Chamar a API do OSRM para obter a rota (nenhuma mudança aqui)
        const profile = 'driving';
        const coordsString = `${origemCoords.lon},${origemCoords.lat};${destinoCoords.lon},${destinoCoords.lat}`;
        const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;

        const routeResponse = await fetch(osrmUrl);
        const routeData = await routeResponse.json();

        if (routeData.code !== 'Ok') {
            throw new Error(routeData.message || 'Não foi possível calcular a rota.');
        }

        // Etapa 4: Exibir os resultados no mapa (nenhuma mudança aqui)
        routeLayer.clearLayers();
        const route = routeData.routes[0];
        const distancia = (route.distance / 1000).toFixed(2);
        const duracaoSegundos = route.duration;
        const duracaoFormatada = new Date(duracaoSegundos * 1000).toISOString().substr(11, 8);

        document.getElementById('resultados').innerHTML = `<strong>Distância:</strong> ${distancia} km | <strong>Duração Aprox.:</strong> ${duracaoFormatada}`;

        const routeGeometry = route.geometry;
        const routeLine = L.geoJSON(routeGeometry, {
            style: { color: '#0056b3', weight: 6 }
        }).addTo(routeLayer);
        
        L.marker([origemCoords.lat, origemCoords.lon]).addTo(routeLayer)
            .bindPopup(`<b>Saída:</b><br>${origemAddress}`);
        L.marker([destinoCoords.lat, destinoCoords.lon]).addTo(routeLayer)
            .bindPopup(`<b>Chegada:</b><br>${destinoAddress}`);

        map.fitBounds(routeLine.getBounds());
        

    } catch (error) {
        alert('Falha ao processar: ' + error.message);
        document.getElementById('resultados').innerHTML = 'Falha ao calcular a rota. Verifique os dados informados.';
    }
}

// Adiciona o evento de clique ao botão
document.getElementById('calcular-rota').addEventListener('click', calculateAndDisplayRoute);