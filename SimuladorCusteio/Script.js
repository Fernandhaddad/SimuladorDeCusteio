// --- Estruturas de Dados e Carregamento Inicial (sem alterações) ---
const veiculos = { 'toco': { nome: 'Toco', pesoMaximo: 16, eixos: 2 }, 'trucado': { nome: 'Caminhão Truck', pesoMaximo: 23, eixos: 3 }, 'cavalo_toco_ls': { nome: 'Cavalo Toco + Carreta LS', pesoMaximo: 41.5, eixos: 5 }, 'cavalo_trucado_ls': { nome: 'Cavalo Trucado + Carreta LS', pesoMaximo: 48.5, eixos: 6 }, 'romeu_julieta': { nome: 'Romeu e Julieta', pesoMaximo: 43, eixos: 7 }, 'vanderleia': { nome: 'Vanderleia', pesoMaximo: 46, eixos: 6 }, 'rodotrem': { nome: 'Rodotrem / Bi-trem', pesoMaximo: 74, eixos: 9 } };
let tabelaAnttData = {};
document.addEventListener('DOMContentLoaded', async () => { try { const response = await fetch('tabela-antt.json'); tabelaAnttData = await response.json(); console.log("Tabela ANTT carregada."); } catch (error) { console.error("Falha ao carregar a tabela ANTT:", error); alert("Não foi possível carregar a tabela de fretes."); } });
const map = L.map('map').setView([-14.235, -51.925], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
function getValidCep(input) { if (!input) return null; const cepLimpo = input.replace(/\D/g, ''); return /^\d{8}$/.test(cepLimpo) ? cepLimpo : null; }
async function fetchAddressFromCep(cep) { const url = `https://viacep.com.br/ws/${cep}/json/`; try { const response = await fetch(url); const data = await response.json(); if (data.erro) { throw new Error('CEP não encontrado.'); } return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`; } catch (error) { console.error('Erro ao buscar CEP:', error); throw error; } }
async function geocodeAddress(address) { const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`; try { const response = await fetch(url); const data = await response.json(); if (data && data.length > 0) { return { lat: data[0].lat, lon: data[0].lon }; } else { throw new Error(`Endereço não encontrado para: "${address}"`); } } catch (error) { console.error('Erro de geocodificação:', error); throw error; } }
function calcularCustoFrete(distanciaKm, veiculo, tipoCarga) { const numEixos = veiculo.eixos; if (!tabelaAnttData[tipoCarga] || !tabelaAnttData[tipoCarga][numEixos]) { throw new Error(`Não há valor na tabela ANTT para um veículo de ${numEixos} eixos com ${tipoCarga}.`); } const coeficientes = tabelaAnttData[tipoCarga][numEixos]; const custoDeslocamento = distanciaKm * coeficientes.ccd; const custoCargaDescarga = coeficientes.cc; return custoDeslocamento + custoCargaDescarga; }


// --- NOVAS FUNÇÕES PARA CÁLCULO DA LEI DO DESCANSO ---

/**
 * Formata segundos em uma string legível (dias, horas, minutos).
 * @param {number} totalSegundos - O total de segundos a ser formatado.
 * @returns {string} - A string formatada.
 */
function formatarDuracao(totalSegundos) {
    if (totalSegundos < 0) return "0s";
    const dias = Math.floor(totalSegundos / 86400);
    const horas = Math.floor((totalSegundos % 86400) / 3600);
    const minutos = Math.floor((totalSegundos % 3600) / 60);

    let resultado = "";
    if (dias > 0) resultado += `${dias}d `;
    if (horas > 0) resultado += `${horas}h `;
    if (minutos > 0) resultado += `${minutos}min`;
    
    return resultado.trim() || "0min";
}

/**
 * Calcula a duração realista da viagem, incluindo paradas obrigatórias pela Lei 13.103/2015.
 * @param {number} tempoConducaoSegundos - O tempo total de condução puro, vindo da API de rotas.
 * @returns {object} - Um objeto com os detalhes da duração.
 */
function calcularDuracaoRealista(tempoConducaoSegundos) {
    // Constantes da Lei em segundos
    const MAX_CONDUCAO_CONTINUA = 5.5 * 3600;  // 5h30min
    const DESCANSO_CURTO = 30 * 60;             // 30min
    const MAX_JORNADA_DIARIA = 10 * 3600;       // 8h + 2h extras
    const DESCANSO_DIARIO = 11 * 3600;          // 11h

    let tempoConducaoRestante = tempoConducaoSegundos;
    let tempoTotalViagem = 0;
    let paradasCurtas = 0;
    let paradasLongas = 0;

    while (tempoConducaoRestante > 0) {
        // Simula um dia de trabalho
        let conducaoHoje = Math.min(tempoConducaoRestante, MAX_JORNADA_DIARIA);
        
        // Adiciona o tempo de condução do dia ao total da viagem
        tempoTotalViagem += conducaoHoje;
        
        // Calcula as paradas curtas (30min) necessárias para o trecho de hoje
        if (conducaoHoje > MAX_CONDUCAO_CONTINUA) {
            // A cada 5.5h, uma parada. Math.ceil garante a parada mesmo se passar um pouco.
            const numeroDeParadasCurtasHoje = Math.floor(conducaoHoje / MAX_CONDUCAO_CONTINUA);
            tempoTotalViagem += numeroDeParadasCurtasHoje * DESCANSO_CURTO;
            paradasCurtas += numeroDeParadasCurtasHoje;
        }

        tempoConducaoRestante -= conducaoHoje;

        // Se ainda há viagem pela frente, adiciona o descanso diário de 11h
        if (tempoConducaoRestante > 0) {
            tempoTotalViagem += DESCANSO_DIARIO;
            paradasLongas++;
        }
    }

    return {
        duracaoTotalSegundos: tempoTotalViagem,
        tempoDirigindoSegundos: tempoConducaoSegundos,
        tempoParadoSegundos: tempoTotalViagem - tempoConducaoSegundos,
        paradas30min: paradasCurtas,
        paradas11h: paradasLongas
    };
}


// --- Função Principal Atualizada ---
async function calculateAndDisplayRoute() {
    // 1. Obter e validar todos os inputs (sem alterações)
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoCarga = document.getElementById('tipo-carga').value;
    const veiculoId = document.getElementById('veiculo').value;
    const pesoCargaInput = document.getElementById('peso-carga').value;
    if (!origemInput || !destinoInput || !pesoCargaInput) { alert('Por favor, preencha todos os campos: origem, destino e peso da carga.'); return; }
    const pesoCarga = parseFloat(pesoCargaInput);
    if (isNaN(pesoCarga) || pesoCarga <= 0) { alert('Por favor, insira um peso de carga válido.'); return; }
    const veiculoSelecionado = veiculos[veiculoId];
    if (pesoCarga > veiculoSelecionado.pesoMaximo) { alert(`ERRO: O peso da carga (${pesoCarga}t) excede a capacidade máxima do ${veiculoSelecionado.nome} (${veiculoSelecionado.pesoMaximo}t).`); return; }
    document.getElementById('resultados').innerHTML = 'Processando e calculando...';

    try {
        // 2. Processar rota (sem alterações)
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

        // 3. CALCULAR CUSTO E DURAÇÃO REALISTA
        const custoFrete = calcularCustoFrete(distanciaKm, veiculoSelecionado, tipoCarga);
        const duracaoRealista = calcularDuracaoRealista(tempoConducaoOriginalSegundos);

        // 4. Exibir resultados completos e detalhados
        routeLayer.clearLayers();
        document.getElementById('resultados').innerHTML = `
            <div class="resultado-bloco">
                <strong>Distância:</strong> ${distanciaKm.toFixed(2)} km <br>
                <strong>Veículo:</strong> ${veiculoSelecionado.nome} (${veiculoSelecionado.eixos} eixos)
            </div>
            <div class="resultado-bloco">
                <strong style="font-size: 1.2em; color: #007bff;">Custo Mínimo (ANTT): R$ ${custoFrete.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
            <div class="resultado-bloco">
                <strong>Tempo Total de Viagem (com descansos): <span style="font-size: 1.1em;">${formatarDuracao(duracaoRealista.duracaoTotalSegundos)}</span></strong><br>
                <span>Tempo em condução: ${formatarDuracao(duracaoRealista.tempoDirigindoSegundos)}</span><br>
                <span>Tempo em paradas: ${formatarDuracao(duracaoRealista.tempoParadoSegundos)} (inclui ${duracaoRealista.paradas30min} parada(s) de 30min e ${duracaoRealista.paradas11h} pernoite(s) de 11h)</span>
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