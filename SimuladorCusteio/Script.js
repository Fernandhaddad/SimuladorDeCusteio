// =================================================================
// 1. VARIÁVEIS GLOBAIS E CARREGAMENTO DE DADOS
// =================================================================
let veiculosData = {};
let tabelaAnttData = {};
let salariosData = {};
let estadoParaUFData = {};
let custosVariaveisData = {};
let precosCombustivelData = {};
let custosPneusData = {};
let custosFixosAnuaisData = {}; 

document.addEventListener('DOMContentLoaded', async () => {

    try {
        const responses = await Promise.all([
            fetch('dados/tabela-antt-2024.json'),
            fetch('dados/veiculos.json'),
            fetch('dados/salarios-motorista.json'),
            fetch('dados/estados-uf.json'),
            fetch('dados/custos-variaveis.json'),
            fetch('dados/precos-combustivel-estados.json'),
            fetch('dados/custos-pneus.json'),
            fetch('dados/custos-fixos-anuais.json')
        ]);

        for (const response of responses) {
            if (!response.ok) {
                // Esta linha ajudará a identificar exatamente qual arquivo falhou
                throw new Error(`Falha ao carregar o arquivo: ${response.url} (Status: ${response.status})`);
            }
        }

        [tabelaAnttData, veiculosData, salariosData, estadoParaUFData, custosVariaveisData, precosCombustivelData, custosPneusData, custosFixosAnuaisData] = await Promise.all(responses.map(r => r.json()));
        
        console.log("Todos os 8 arquivos de dados foram carregados com sucesso.");

    } catch (error) {
        console.error("Falha ao carregar dados iniciais:", error);
        alert("Não foi possível carregar os arquivos de dados. A aplicação não funcionará. Verifique o console para mais detalhes.");
    }
});

// =================================================================
// 2. INICIALIZAÇÃO DO MAPA
// =================================================================
const map = L.map('map').setView([-14.235, -51.925], 4);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);


// =================================================================
// 3. FUNÇÕES DE API (Comunicação Externa)
// =================================================================
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&addressdetails=1`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
            const details = data[0];
            const estado = (details.address && details.address.state) ? details.address.state : '';
            return { lat: details.lat, lon: details.lon, estado: estado };
        } else { throw new Error(`Endereço não encontrado para: "${address}"`); }
    } catch (error) { console.error('Erro de geocodificação:', error); throw error; }
}

async function fetchAddressFromCep(cep) {
    const url = `https://viacep.com.br/ws/${cep}/json/`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.erro) { throw new Error('CEP não encontrado.'); }
        return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`;
    } catch (error) { console.error('Erro ao buscar CEP:', error); throw error; }
}


// =================================================================
// 4. FUNÇÕES DE CÁLCULO E LÓGICA DE NEGÓCIO
// =================================================================
function getValidCep(input) { if (!input) return null; const cepLimpo = input.replace(/\D/g, ''); return /^\d{8}$/.test(cepLimpo) ? cepLimpo : null; }
function formatarDuracao(totalSegundos) { if (totalSegundos < 0) return "0s"; const dias = Math.floor(totalSegundos / 86400); const horas = Math.floor((totalSegundos % 86400) / 3600); const minutos = Math.floor((totalSegundos % 3600) / 60); let resultado = ""; if (dias > 0) resultado += `${dias}d `; if (horas > 0) resultado += `${horas}h `; if (minutos > 0) resultado += `${minutos}min`; return resultado.trim() || "0min"; }
function calcularDuracaoRealista(tempoConducaoSegundos) { const MAX_CONDUCAO_CONTINUA = 5.5 * 3600; const DESCANSO_CURTO = 30 * 60; const MAX_JORNADA_DIARIA = 10 * 3600; const DESCANSO_DIARIO = 11 * 3600; let tempoConducaoRestante = tempoConducaoSegundos; let tempoTotalViagem = 0; let paradasCurtas = 0; let paradasLongas = 0; while (tempoConducaoRestante > 0) { let conducaoHoje = Math.min(tempoConducaoRestante, MAX_JORNADA_DIARIA); tempoTotalViagem += conducaoHoje; if (conducaoHoje > MAX_CONDUCAO_CONTINUA) { const numeroDeParadasCurtasHoje = Math.floor(conducaoHoje / MAX_CONDUCAO_CONTINUA); tempoTotalViagem += numeroDeParadasCurtasHoje * DESCANSO_CURTO; paradasCurtas += numeroDeParadasCurtasHoje; } tempoConducaoRestante -= conducaoHoje; if (tempoConducaoRestante > 0) { tempoTotalViagem += DESCANSO_DIARIO; paradasLongas++; } } return { duracaoTotalSegundos: tempoTotalViagem, tempoDirigindoSegundos: tempoConducaoSegundos, tempoParadoSegundos: tempoTotalViagem - tempoConducaoSegundos, paradas30min: paradasCurtas, paradas11h: paradasLongas }; }
function calcularCustoFrete(distanciaKm, veiculo, tipoCarga, tipoOperacao) { const numEixos = veiculo.eixos; const tabelaSelecionada = tabelaAnttData[tipoOperacao]; if (!tabelaSelecionada) { throw new Error("Tipo de operação (Tabela) inválido."); } const coeficientes = tabelaSelecionada.cargas[tipoCarga]?.[numEixos]; if (!coeficientes || coeficientes.ccd === null) { throw new Error(`Combinação inválida: Não há valor na ${tabelaSelecionada.titulo} para o tipo de carga selecionado com um veículo de ${numEixos} eixos.`); } const custoDeslocamento = distanciaKm * 2 * coeficientes.ccd; const custoCargaDescarga = coeficientes.cc; const custoTotal = custoDeslocamento + custoCargaDescarga; return { custoTotal: custoTotal, tituloTabela: tabelaSelecionada.titulo }; }
function calcularCustoOperacionalFixo(veiculo, duracaoViagemDias, ufOrigem) { const depreciacaoAnual = veiculo.valor / veiculo.vidaUtilAnos; const depreciacaoMensal = depreciacaoAnual / 12; const custoFixoMensalTotal = depreciacaoMensal + veiculo.custoManutencaoMensal; const custoFixoDiario = custoFixoMensalTotal / 30; const custoDepreciacaoManutencaoViagem = custoFixoDiario * duracaoViagemDias; const taxaLicenciamentoAnual = custosFixosAnuaisData.licenciamento_anual[ufOrigem]; let custoLicenciamentoViagem = 0; if (taxaLicenciamentoAnual) { const custoDiarioLicenciamento = taxaLicenciamentoAnual / 365; custoLicenciamentoViagem = custoDiarioLicenciamento * duracaoViagemDias; } else { console.warn(`Valor de licenciamento não encontrado para a UF: ${ufOrigem}. Custo não será adicionado.`); } return { custoTotalFixo: custoDepreciacaoManutencaoViagem + custoLicenciamentoViagem, depreciacaoViagem: (depreciacaoMensal / 30) * duracaoViagemDias, manutencaoViagem: (veiculo.custoManutencaoMensal / 30) * duracaoViagemDias, licenciamentoViagem: custoLicenciamentoViagem }; }
function calcularCustoSalario(salarioMensal, duracaoViagemSegundos) { const salarioDiario = salarioMensal / 21; const duracaoExataEmDias = duracaoViagemSegundos / 86400; const diasOcupados = Math.ceil(duracaoExataEmDias); const custoSalarioViagem = salarioDiario * diasOcupados; return custoSalarioViagem; }
function calcularCustoVariavel(distanciaKm, veiculo, tipoCarga, ufOrigem) { const { precos, consumo_arla_percentual_sobre_diesel, consumo_diesel_kml } = custosVariaveisData; const numEixos = veiculo.eixos; const precoDieselDoEstado = precosCombustivelData[ufOrigem]; if (!precoDieselDoEstado) { throw new Error(`Preço do diesel não encontrado para o estado ${ufOrigem}.`); } let rendimentoKmL = 0; if (consumo_diesel_kml.excecoes[tipoCarga] && consumo_diesel_kml.excecoes[tipoCarga][numEixos]) { rendimentoKmL = consumo_diesel_kml.excecoes[tipoCarga][numEixos]; } else { const tabelaConsumo = (tipoCarga === 'frigorificada' || tipoCarga === 'perigosa_frigorificada') ? consumo_diesel_kml.frigorificada : consumo_diesel_kml.outros; rendimentoKmL = tabelaConsumo[numEixos]; } if (!rendimentoKmL) { throw new Error(`Não foi possível encontrar o rendimento de combustível para um veículo de ${numEixos} eixos com carga ${tipoCarga}.`); } const litrosDiesel = distanciaKm / rendimentoKmL; const custoDiesel = litrosDiesel * precoDieselDoEstado; const litrosArla = litrosDiesel * consumo_arla_percentual_sobre_diesel; const custoArla = litrosArla * precos.arla32_litro; return { custoTotalVariavel: custoDiesel + custoArla, custoDiesel: custoDiesel, custoArla: custoArla }; }
function calcularCustoPneus(distanciaKm, veiculo) { const numEixos = veiculo.eixos; const precoPneuDirecional = custosPneusData.preco_pneu_novo.direcional[numEixos]; const vidaUtilDirecional = custosPneusData.vida_util_km.direcional_sem_recauchutagem; const custoKmPneuDirecional = precoPneuDirecional / vidaUtilDirecional; const custoTotalDirecionais = custoKmPneuDirecional * custosPneusData.numero_pneus.direcionais; const precoPneuTraseiro = custosPneusData.preco_pneu_novo.traseiro[numEixos]; const custoRecauchutagem = custosPneusData.recauchutagem.preco * custosPneusData.recauchutagem.numero_por_pneu_traseiro; const vidaUtilTraseiro = custosPneusData.vida_util_km.traseiro_com_recauchutagem; const custoTotalVidaPneuTraseiro = precoPneuTraseiro + custoRecauchutagem; const custoKmPneuTraseiro = custoTotalVidaPneuTraseiro / vidaUtilTraseiro; const eixosTraseiros = numEixos - 1; const numeroPneusTraseiros = eixosTraseiros > 0 ? eixosTraseiros * custosPneusData.numero_pneus.traseiros_por_eixo : 0; const custoTotalTraseiros = custoKmPneuTraseiro * numeroPneusTraseiros; const custoTotalPneusPorKm = custoTotalDirecionais + custoTotalTraseiros; const custoPneusParaViagem = custoTotalPneusPorKm * distanciaKm; return custoPneusParaViagem; }


// =================================================================
// 5. FUNÇÃO PRINCIPAL (ORQUESTRADOR)
// =================================================================
async function calculateAndDisplayRoute() {
    // Obter e validar inputs
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoOperacao = document.getElementById('tipo-operacao').value;
    const tipoCarga = document.getElementById('tipo-carga').value;
    const veiculoId = document.getElementById('veiculo').value;
    const pesoCargaInput = document.getElementById('peso-carga').value;
    if (!origemInput || !destinoInput || !pesoCargaInput) { alert('Por favor, preencha todos os campos.'); return; }
    const pesoCarga = parseFloat(pesoCargaInput);
    if (isNaN(pesoCarga) || pesoCarga <= 0) { alert('Por favor, insira um peso de carga válido.'); return; }
    const veiculoSelecionado = veiculosData[veiculoId];
    if (!veiculoSelecionado) { alert("Dados do veículo não carregados."); return; }
    let numeroDeViagens = 1;
    let avisoMultiViagem = '';
    if (pesoCarga > veiculoSelecionado.pesoMaximo) {
        numeroDeViagens = Math.ceil(pesoCarga / veiculoSelecionado.pesoMaximo);
        avisoMultiViagem = `<div class="resultado-bloco aviso"><strong>Atenção:</strong> A carga de ${pesoCarga}t excede a capacidade do veículo (${veiculoSelecionado.pesoMaximo}t).<br>Serão necessárias <strong>${numeroDeViagens} viagens</strong>.</div>`;
    }
    document.getElementById('resultados').innerHTML = 'Processando e calculando...';

    try {
        const processInput = async (input) => { const cep = getValidCep(input); return cep ? await fetchAddressFromCep(cep) : input; };
        const origemAddressText = await processInput(origemInput);
        const origemInfo = await geocodeAddress(origemAddressText);
        const destinoAddressText = await processInput(destinoInput);
        const destinoInfo = await geocodeAddress(destinoAddressText);
        
        const profile = 'driving';
        const coordsString = `${origemInfo.lon},${origemInfo.lat};${destinoInfo.lon},${destinoInfo.lat}`;
        const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;
        const routeResponse = await fetch(osrmUrl);
        const routeData = await routeResponse.json();
        if (routeData.code !== 'Ok') throw new Error(routeData.message || 'Não foi possível calcular a rota.');

        const distanciaKm = (routeData.routes[0].distance / 1000);
        const tempoConducaoOriginalSegundos = routeData.routes[0].duration;

        const freteInfoPorViagem = calcularCustoFrete(distanciaKm, veiculoSelecionado, tipoCarga, tipoOperacao);
        const duracaoRealistaPorViagem = calcularDuracaoRealista(tempoConducaoOriginalSegundos);
        const duracaoViagemEmDias = duracaoRealistaPorViagem.duracaoTotalSegundos / 86400;
        
        const ufOrigem = estadoParaUFData[origemInfo.estado];
        if (!ufOrigem) { throw new Error(`Não foi possível determinar a UF para o estado de origem: ${origemInfo.estado || 'desconhecido'}.`); }
        
        const custoFixoPorViagem = calcularCustoOperacionalFixo(veiculoSelecionado, duracaoViagemEmDias, ufOrigem);
        
        if (!salariosData[ufOrigem]) { throw new Error(`Não foi encontrado um salário base para a UF: ${ufOrigem}.`); }
        const salarioMensal = salariosData[ufOrigem];
        const custoSalarioPorViagem = calcularCustoSalario(salarioMensal, duracaoRealistaPorViagem.duracaoTotalSegundos);
        
        const custoVariavelPorViagem = calcularCustoVariavel(distanciaKm, veiculoSelecionado, tipoCarga, ufOrigem);
        const custoPneusPorViagem = calcularCustoPneus(distanciaKm, veiculoSelecionado);

        const custoOperacionalTotalPorViagem = custoFixoPorViagem.custoTotalFixo + custoSalarioPorViagem + custoVariavelPorViagem.custoTotalVariavel + custoPneusPorViagem;
        const custoTotalOperacaoANTT = freteInfoPorViagem.custoTotal * numeroDeViagens;
        const duracaoTotalOperacaoSegundos = duracaoRealistaPorViagem.duracaoTotalSegundos * numeroDeViagens;

        routeLayer.clearLayers();
        document.getElementById('resultados').innerHTML = `
            ${avisoMultiViagem}
            <div class="resultado-bloco"><strong>Distância (por viagem):</strong> ${distanciaKm.toFixed(2)} km | <strong>Veículo:</strong> ${veiculoSelecionado.nome}</div>
            <div class="resultado-bloco">
                <strong style="font-size: 1.2em; color: #007bff;">Custo Mínimo (ANTT): R$ ${custoTotalOperacaoANTT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><br>
                <span style="font-size: 0.9em; color: #555;">Baseado em ${numeroDeViagens} viagem(ns) de R$ ${freteInfoPorViagem.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada</span>
            </div>
            <div class="resultado-bloco">
                <strong style="font-size: 1.2em; color: #28a745;">Seu Custo Operacional Total: R$ ${(custoOperacionalTotalPorViagem * numeroDeViagens).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><br>
                <span style="font-size: 0.9em; color: #555;">
                    Combustível (Base ${ufOrigem}): R$ ${(custoVariavelPorViagem.custoDiesel * numeroDeViagens).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
                    Pneus: R$ ${(custoPneusPorViagem * numeroDeViagens).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
                    Salário: R$ ${(custoSalarioPorViagem * numeroDeViagens).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
                    Fixos: R$ ${(custoFixoPorViagem.custoTotalFixo * numeroDeViagens).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
            </div>
            <div class="resultado-bloco">
                <strong>Duração Total da Operação: <span style="font-size: 1.1em;">${formatarDuracao(duracaoTotalOperacaoSegundos)}</span></strong><br>
                <span style="font-size: 0.9em; color: #555;">
                    Considerando ${numeroDeViagens} viagem(ns) de ${formatarDuracao(duracaoRealistaPorViagem.duracaoTotalSegundos)} cada.<br>
                    <small><em>(Cada viagem inclui aprox. ${duracaoRealistaPorViagem.paradas11h} pernoite(s) e ${duracaoRealistaPorViagem.paradas30min} parada(s) de 30min)</em></small>
                </span>
            </div>
        `;
        
        const routeGeometry = routeData.routes[0].geometry;
        const routeLine = L.geoJSON(routeGeometry, { style: { color: '#0056b3', weight: 6 } }).addTo(routeLayer);
        L.marker([origemInfo.lat, origemInfo.lon]).addTo(routeLayer).bindPopup(`<b>Saída:</b><br>${origemAddressText}`);
        L.marker([destinoInfo.lat, destinoInfo.lon]).addTo(routeLayer).bindPopup(`<b>Chegada:</b><br>${destinoAddressText}`);
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        alert('Falha no cálculo: ' + error.message);
        document.getElementById('resultados').innerHTML = 'Falha ao processar a solicitação. Verifique os dados.';
    }
}


// =================================================================
// 6. EVENT LISTENER (Ponto de Entrada)
// =================================================================
document.getElementById('calcular-rota').addEventListener('click', calculateAndDisplayRoute);