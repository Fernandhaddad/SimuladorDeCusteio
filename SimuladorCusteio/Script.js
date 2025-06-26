// --- Estrutura de Dados dos Veículos (ATUALIZADA COM EIXOS) ---
const veiculos = {
    'toco': { nome: 'Toco', pesoMaximo: 16, eixos: 2 },
    'trucado': { nome: 'Caminhão Truck', pesoMaximo: 23, eixos: 3 },
    'cavalo_toco_ls': { nome: 'Cavalo Toco + Carreta LS', pesoMaximo: 41.5, eixos: 5 },
    'cavalo_trucado_ls': { nome: 'Cavalo Trucado + Carreta LS', pesoMaximo: 48.5, eixos: 6 },
    'romeu_julieta': { nome: 'Romeu e Julieta', pesoMaximo: 43, eixos: 7 },
    'vanderleia': { nome: 'Vanderleia', pesoMaximo: 46, eixos: 6 },
    'rodotrem': { nome: 'Rodotrem / Bi-trem', pesoMaximo: 74, eixos: 9 } // Peso máximo varia com legislação
};

// Variável para armazenar os dados da tabela ANTT
let tabelaAnttData = {};

// --- Carregamento Inicial dos Dados da Tabela ANTT ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('tabela-antt.json');
        tabelaAnttData = await response.json();
        console.log("Tabela ANTT carregada com sucesso.");
    } catch (error) {
        console.error("Falha ao carregar a tabela ANTT:", error);
        alert("Não foi possível carregar a tabela de fretes. O cálculo de custo não funcionará.");
    }
});


// --- Configuração Inicial do Mapa (sem alterações) ---
const map = L.map('map').setView([-14.235, -51.925], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);


// --- Funções Auxiliares de CEP e Endereço (sem alterações) ---
// ... (mantenha as funções getValidCep, fetchAddressFromCep, geocodeAddress exatamente como estavam) ...
function getValidCep(input) { if (!input) return null; const cepLimpo = input.replace(/\D/g, ''); return /^\d{8}$/.test(cepLimpo) ? cepLimpo : null; }
async function fetchAddressFromCep(cep) { const url = `https://viacep.com.br/ws/${cep}/json/`; try { const response = await fetch(url); const data = await response.json(); if (data.erro) { throw new Error('CEP não encontrado.'); } return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`; } catch (error) { console.error('Erro ao buscar CEP:', error); throw error; } }
async function geocodeAddress(address) { const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`; try { const response = await fetch(url); const data = await response.json(); if (data && data.length > 0) { return { lat: data[0].lat, lon: data[0].lon }; } else { throw new Error(`Endereço não encontrado para: "${address}"`); } } catch (error) { console.error('Erro de geocodificação:', error); throw error; } }


// --- NOVA FUNÇÃO PARA CALCULAR O CUSTO DO FRETE ---
function calcularCustoFrete(distanciaKm, veiculo, tipoCarga) {
    const numEixos = veiculo.eixos;
    
    // Verifica se a categoria de carga e o número de eixos existem na tabela
    if (!tabelaAnttData[tipoCarga] || !tabelaAnttData[tipoCarga][numEixos]) {
        throw new Error(`Não há valor na tabela ANTT para um veículo de ${numEixos} eixos com ${tipoCarga}.`);
    }
    
    const coeficientes = tabelaAnttData[tipoCarga][numEixos];
    const custoDeslocamento = distanciaKm * coeficientes.ccd;
    const custoCargaDescarga = coeficientes.cc;
    
    const custoTotal = custoDeslocamento + custoCargaDescarga;
    
    return custoTotal;
}


// --- Função Principal Atualizada ---
async function calculateAndDisplayRoute() {
    // 1. Obter e validar todos os inputs
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoCarga = document.getElementById('tipo-carga').value;
    const veiculoId = document.getElementById('veiculo').value;
    const pesoCargaInput = document.getElementById('peso-carga').value;
    
    if (!origemInput || !destinoInput || !pesoCargaInput) {
        alert('Por favor, preencha todos os campos: origem, destino e peso da carga.');
        return;
    }

    const pesoCarga = parseFloat(pesoCargaInput);
    if (isNaN(pesoCarga) || pesoCarga <= 0) {
        alert('Por favor, insira um peso de carga válido.');
        return;
    }

    const veiculoSelecionado = veiculos[veiculoId];
    if (pesoCarga > veiculoSelecionado.pesoMaximo) {
        alert(`ERRO: O peso da carga (${pesoCarga}t) excede a capacidade máxima do ${veiculoSelecionado.nome} (${veiculoSelecionado.pesoMaximo}t).`);
        return;
    }

    document.getElementById('resultados').innerHTML = 'Processando e calculando...';

    try {
        // 2. Processar rota (como antes)
        const processInput = async (input) => {
            const cep = getValidCep(input);
            return cep ? await fetchAddressFromCep(cep) : input;
        };
        const [origemAddress, destinoAddress] = await Promise.all([processInput(origemInput), processInput(destinoInput)]);
        const [origemCoords, destinoCoords] = await Promise.all([geocodeAddress(origemAddress), geocodeAddress(destinoAddress)]);
        
        const profile = 'driving';
        const coordsString = `${origemCoords.lon},${origemCoords.lat};${destinoCoords.lon},${destinoCoords.lat}`;
        const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;
        const routeResponse = await fetch(osrmUrl);
        const routeData = await routeResponse.json();

        if (routeData.code !== 'Ok') throw new Error(routeData.message || 'Não foi possível calcular a rota.');

        const distanciaKm = (routeData.routes[0].distance / 1000);

        // 3. CALCULAR O CUSTO DO FRETE
        const custoFrete = calcularCustoFrete(distanciaKm, veiculoSelecionado, tipoCarga);

        // 4. Exibir resultados completos
        routeLayer.clearLayers();
        const duracaoFormatada = new Date(routeData.routes[0].duration * 1000).toISOString().substr(11, 8);
        document.getElementById('resultados').innerHTML = 
            `<strong>Distância:</strong> ${distanciaKm.toFixed(2)} km | 
             <strong>Veículo:</strong> ${veiculoSelecionado.nome} (${veiculoSelecionado.eixos} eixos)<br>
             <strong style="font-size: 1.2em; color: #007bff;">Custo Mínimo do Frete (ANTT): R$ ${custoFrete.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`;

        const routeGeometry = routeData.routes[0].geometry;
        const routeLine = L.geoJSON(routeGeometry, { style: { color: '#0056b3', weight: 6 } }).addTo(routeLayer);
        
        L.marker([origemCoords.lat, origemCoords.lon]).addTo(routeLayer).bindPopup(`<b>Saída:</b><br>${origemAddress}`);
        L.marker([destinoCoords.lat, destinoCoords.lon]).addTo(routeLayer).bindPopup(`<b>Chegada:</b><br>${destinoAddress}`);
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        alert('Falha no cálculo: ' + error.message);
        document.getElementById('resultados').innerHTML = 'Falha ao processar a solicitação. Verifique os dados.';
    }
}

document.getElementById('calcular-rota').addEventListener('click', calculateAndDisplayRoute);