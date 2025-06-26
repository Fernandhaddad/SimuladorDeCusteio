const veiculos = {
    'toco': { nome: 'Toco', pesoMaximo: 16, eixos: 2 },
    'trucado': { nome: 'Caminhão Truck', pesoMaximo: 23, eixos: 3 },
    'cavalo_toco_4e': { nome: 'Cavalo Mecânico Simples', pesoMaximo: 33, eixos: 4},
    'cavalo_toco_ls': { nome: 'Cavalo Mecânico Simples + Semirreboque', pesoMaximo: 41.5, eixos: 5 },
    'vanderleia': { nome: 'Vanderleia / Cavalo Trucado + Semirreboque', pesoMaximo: 48.5, eixos: 6 },
    'romeu_julieta': { nome: 'Romeu e Julieta', pesoMaximo: 43, eixos: 7 },
    'rodotrem': { nome: 'Rodotrem / Bi-trem', pesoMaximo: 74, eixos: 9 }
};

let tabelaAnttData = {};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('tabela-antt-2024.json');
        tabelaAnttData = await response.json();
        console.log("Tabela ANTT (Res. 6.046/2024) carregada com sucesso.");
    } catch (error) {
        console.error("Falha ao carregar a tabela ANTT 2024:", error);
        alert("Não foi possível carregar a tabela de fretes. O cálculo de custo não funcionará.");
    }
});

const map = L.map('map').setView([-14.235, -51.925], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
function getValidCep(input) { if (!input) return null; const cepLimpo = input.replace(/\D/g, ''); return /^\d{8}$/.test(cepLimpo) ? cepLimpo : null; }
async function fetchAddressFromCep(cep) { const url = `https://viacep.com.br/ws/${cep}/json/`; try { const response = await fetch(url); const data = await response.json(); if (data.erro) { throw new Error('CEP não encontrado.'); } return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`; } catch (error) { console.error('Erro ao buscar CEP:', error); throw error; } }
async function geocodeAddress(address) { const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`; try { const response = await fetch(url); const data = await response.json(); if (data && data.length > 0) { return { lat: data[0].lat, lon: data[0].lon }; } else { throw new Error(`Endereço não encontrado para: "${address}"`); } } catch (error) { console.error('Erro de geocodificação:', error); throw error; } }
function formatarDuracao(totalSegundos) { if (totalSegundos < 0) return "0s"; const dias = Math.floor(totalSegundos / 86400); const horas = Math.floor((totalSegundos % 86400) / 3600); const minutos = Math.floor((totalSegundos % 3600) / 60); let resultado = ""; if (dias > 0) resultado += `${dias}d `; if (horas > 0) resultado += `${horas}h `; if (minutos > 0) resultado += `${minutos}min`; return resultado.trim() || "0min"; }
function calcularDuracaoRealista(tempoConducaoSegundos) { const MAX_CONDUCAO_CONTINUA = 5.5 * 3600; const DESCANSO_CURTO = 30 * 60; const MAX_JORNADA_DIARIA = 10 * 3600; const DESCANSO_DIARIO = 11 * 3600; let tempoConducaoRestante = tempoConducaoSegundos; let tempoTotalViagem = 0; let paradasCurtas = 0; let paradasLongas = 0; while (tempoConducaoRestante > 0) { let conducaoHoje = Math.min(tempoConducaoRestante, MAX_JORNADA_DIARIA); tempoTotalViagem += conducaoHoje; if (conducaoHoje > MAX_CONDUCAO_CONTINUA) { const numeroDeParadasCurtasHoje = Math.floor(conducaoHoje / MAX_CONDUCAO_CONTINUA); tempoTotalViagem += numeroDeParadasCurtasHoje * DESCANSO_CURTO; paradasCurtas += numeroDeParadasCurtasHoje; } tempoConducaoRestante -= conducaoHoje; if (tempoConducaoRestante > 0) { tempoTotalViagem += DESCANSO_DIARIO; paradasLongas++; } } return { duracaoTotalSegundos: tempoTotalViagem, tempoDirigindoSegundos: tempoConducaoSegundos, tempoParadoSegundos: tempoTotalViagem - tempoConducaoSegundos, paradas30min: paradasCurtas, paradas11h: paradasLongas }; }

function calcularCustoFrete(distanciaKm, veiculo, tipoCarga, tipoOperacao) {
    const numEixos = veiculo.eixos;
    
    // Busca a tabela correta (A, B, C ou D)
    const tabelaSelecionada = tabelaAnttData[tipoOperacao];
    if (!tabelaSelecionada) {
        throw new Error("Tipo de operação (Tabela) inválido.");
    }

    // Busca os coeficientes para a carga e o número de eixos
    // O '?.' (optional chaining) ajuda a evitar erros se 'cargas' ou 'tipoCarga' não existirem
    const coeficientes = tabelaSelecionada.cargas[tipoCarga]?.[numEixos];
    
    // ESTA É A LINHA DE VALIDAÇÃO MAIS IMPORTANTE
    // Ela verifica se a busca encontrou algo E se o valor de CCD não é nulo.
    if (!coeficientes || coeficientes.ccd === null) {
        throw new Error(`Combinação inválida: Não há valor na ${tabelaSelecionada.titulo} para o tipo de carga selecionado com um veículo de ${numEixos} eixos.`);
    }
    
    // Se a validação acima passar, o código continua para o cálculo
    const custoDeslocamento = distanciaKm * coeficientes.ccd;
    const custoCargaDescarga = coeficientes.cc;
    const custoTotal = custoDeslocamento + custoCargaDescarga;
    
    return {
        custoTotal: custoTotal,
        tituloTabela: tabelaSelecionada.titulo
    };
}

async function calculateAndDisplayRoute() {
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoOperacao = document.getElementById('tipo-operacao').value;
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
        const processInput = async (input) => { const cep = getValidCep(input); return cep ? await fetchAddressFromCep(cep) : input; };
        const [origemAddress, destinoAddress] = await Promise.all([processInput(origemInput), processInput(destinoInput)]);
        const [origemCoords, destinoCoords] = await Promise.all([geocodeAddress(origemAddress), geocodeAddress(destinoAddress)]);
        
        const profile = 'driving';
        const coordsString = `${origemCoords.lon},${origemCoords.lat};${destinoCoords.lon},${destinoCoords.lat}`;
        const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;
        const routeResponse = await fetch(osrmUrl);
        const routeData = await routeResponse.json();

        if (routeData.code !== 'Ok') throw new Error(routeData.message || 'Não foi possível calcular a rota.');

        const distanciaKm = (routeData.routes[0].distance / 1000);
        const tempoConducaoOriginalSegundos = routeData.routes[0].duration;

        const freteInfo = calcularCustoFrete(distanciaKm, veiculoSelecionado, tipoCarga, tipoOperacao);
        const duracaoRealista = calcularDuracaoRealista(tempoConducaoOriginalSegundos);

        routeLayer.clearLayers();
        document.getElementById('resultados').innerHTML = `
            <div class="resultado-bloco">
                <strong>Distância:</strong> ${distanciaKm.toFixed(2)} km | <strong>Veículo:</strong> ${veiculoSelecionado.nome} (${veiculoSelecionado.eixos} eixos)
            </div>
            <div class="resultado-bloco">
                <strong style="font-size: 1.2em; color: #007bff;">Custo Mínimo (ANTT): R$ ${freteInfo.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><br>
                <span style="font-size: 0.9em; color: #555;">Cálculo baseado na: ${freteInfo.tituloTabela}</span>
            </div>
            <div class="resultado-bloco">
                <strong>Tempo Total de Viagem (com descansos): <span style="font-size: 1.1em;">${formatarDuracao(duracaoRealista.duracaoTotalSegundos)}</span></strong><br>
                <span>(Tempo em condução: ${formatarDuracao(duracaoRealista.tempoDirigindoSegundos)} | Tempo em paradas: ${formatarDuracao(duracaoRealista.tempoParadoSegundos)})</span>
            </div>
        `;

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