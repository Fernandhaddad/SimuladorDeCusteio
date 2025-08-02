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

// Constantes Globais para o CÁLCULO NTC (Seu Custo Operacional Total)
const GLOBAL_HORAS_TRABALHADAS_MES = 220; // H: Horas trabalhadas por mês (NTC sugere 200 a 240)
const GLOBAL_VELOCIDADE_MEDIA_KMH = 60;   // V: Velocidade média de transporte em km/h
const GLOBAL_COEFICIENTE_TERMINAIS = 1.0; // C: Coeficiente de uso de terminais (valor médio = 1)
const GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL = 15; // L: Lucro operacional em percentual (ex: 15 para 15% de lucro)
const GLOBAL_TEMPO_CARGA_DESCARGA_HORAS = 3; // Tcd: Tempo de carga e descarga em horas (para lotação)
const GLOBAL_DESPESAS_INDIRETAS_MENSAIS = 50000; // DAT: Despesas administrativas e de terminais mensais
const GLOBAL_TONELAGEM_EXPEDIDA_MENSAL = 1000; // T.EXP: Tonelagem expedida pela empresa no mês (para rateio do DI)
const GLOBAL_TAXA_REMUNERACAO_CAPITAL_ANUAL = 0.12; // 12% ao ano
const GLOBAL_PERCENTUAL_PERDA_DEPRECIACAO = 0.95; // 95% de perda, 5% de valor de revenda

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
                throw new Error(`Falha ao carregar o arquivo: ${response.url} (Status: ${response.status})`);
            }
        }

        [tabelaAnttData, veiculosData, salariosData, estadoParaUFData, custosVariaveisData, precosCombustivelData, custosPneusData, custosFixosAnuaisData] = await Promise.all(responses.map(r => r.json()));
        
        console.log("Todos os 8 arquivos de dados foram carregados com sucesso.");

        const calcularRotaBtn = document.getElementById('calcular-rota');
        if (calcularRotaBtn) {
            calcularRotaBtn.addEventListener('click', calculateAndDisplayRoute);
            console.log("Botão 'Calcular Frete Mínimo' configurado com sucesso.");
        } else {
            alert("Erro: Botão 'calcular-rota' não encontrado no HTML. O simulador não funcionará.");
            console.error("Elemento com ID 'calcular-rota' não encontrado.");
        }

    } catch (error) {
        console.error("Falha ao carregar dados iniciais:", error);
        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Falha ao carregar dados. ${error.message}</div>`;
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
function formatarDuracao(totalSegundos) {
    if (totalSegundos < 0) return "0s";
    const dias = Math.floor(totalSegundos / 86400);
    const horas = Math.floor((totalSegundos % 86400) / 3600);
    const minutos = Math.floor((totalSegundos % 3600) / 60);
    let resultado = ""; if (dias > 0) resultado += `${dias}d `;
    if (horas > 0) resultado += `${horas}h `;
    if (minutos > 0) resultado += `${minutos}min`;
    return resultado.trim() || "0min";
}
function calcularDuracaoRealista(tempoConducaoSegundos) {
    const MAX_CONDUCAO_CONTINUA = 5.5 * 3600;
    const DESCANSO_CURTO = 30 * 60;
    const MAX_JORNADA_DIARIA = 10 * 3600;
    const DESCANSO_DIARIO = 11 * 3600;
    let tempoConducaoRestante = tempoConducaoSegundos;
    let tempoTotalViagem = 0;
    let paradasCurtas = 0;
    let paradasLongas = 0;
    while (tempoConducaoRestante > 0) {
        let conducaoHoje = Math.min(tempoConducaoRestante, MAX_JORNADA_DIARIA);
        tempoTotalViagem += conducaoHoje;
        if (conducaoHoje > MAX_CONDUCAO_CONTINUA) {
            const numeroDeParadasCurtasHoje = Math.floor(conducaoHoje / MAX_CONDUCAO_CONTINUA);
            tempoTotalViagem += numeroDeParadasCurtasHoje * DESCANSO_CURTO;
            paradasCurtas += numeroDeParadasCurtasHoje;
        } tempoConducaoRestante -= conducaoHoje;
        if (tempoConducaoRestante > 0) {
            tempoTotalViagem += DESCANSO_DIARIO; paradasLongas++; }
    }
    return { duracaoTotalSegundos: tempoTotalViagem, tempoDirigindoSegundos: tempoConducaoSegundos, tempoParadoSegundos: tempoTotalViagem - tempoConducaoSegundos, paradas30min: paradasCurtas, paradas11h: paradasLongas };
}

// =================================================================
// FUNÇÕES DE CÁLCULO ANTT (TABELA OFICIAL) - CORRIGIDA
// =================================================================
function calcularCustoFreteANTTOfficial(distanciaKm, veiculo, tipoCarga, tipoOperacao) {
    const numEixos = veiculo.eixos;
    const tabelaSelecionada = tabelaAnttData[tipoOperacao];
    if (!tabelaSelecionada) { throw new Error("Tipo de operação (Tabela ANTT) inválido."); }
    const coeficientes = tabelaSelecionada.cargas[tipoCarga]?.[numEixos];
    if (!coeficientes || coeficientes.ccd === null) { throw new Error(`Combinação inválida: Não há valor na ${tabelaSelecionada.titulo} para o tipo de carga selecionado com um veículo de ${numEixos} eixos.`); }
    
    let custoDeslocamento = distanciaKm * coeficientes.ccd;
    const custoCargaDescarga = coeficientes.cc;

    // CORREÇÃO: Duplica o custo de deslocamento para Carga Lotação (Tabelas A e C)
    if (tipoOperacao === 'tabela_a' || tipoOperacao === 'tabela_c') {
        custoDeslocamento *= 2; // Custo de ida e volta (retorno vazio)
    }

    const custoTotal = custoDeslocamento + custoCargaDescarga;
    
    return { custoTotal: custoTotal, tituloTabela: tabelaSelecionada.titulo };
}


// =================================================================
// FUNÇÕES DE CÁLCULO NTC (SEU CUSTO OPERACIONAL) - VERSÃO FINAL
// Baseadas estritamente no "Manual de Cálculo de Custos e Formação de Preços"
// =================================================================

/**
 * Calcula o Custo Fixo Mensal (CF) do veículo, conforme NTC (Cap. III).
 * @returns {number} O Custo Fixo Mensal (CF) em R$.
 */
function calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem) {
    // RC = Valor do veículo completo x (taxa remuneração anual / 12)
    const RC = veiculo.valor * (GLOBAL_TAXA_REMUNERACAO_CAPITAL_ANUAL / 12);

    // SM = (1 + % Encargos Sociais) x salário do motorista x nº motoristas
    const salarioBase = salariosData[ufOrigem] || veiculo.salarioMotoristaMensal;
    const SM = (1 + veiculo.encargosSociaisMotorista) * salarioBase * 1;

    // SO (Salários de oficina) - CORRIGIDO: Utilizando o dado específico do veículo.
    const SO = veiculo.custoManutencaoMensal;

    // RV = (% de perda x valor do veículo zero km sem pneus) / Vida Útil em meses
    const RV = (GLOBAL_PERCENTUAL_PERDA_DEPRECIACAO * veiculo.valorSemPneus) / (veiculo.vidaUtilAnos * 12);

    // TI = (IPVA + DPVAT + Licenciamento) / 12
    const ipvaAnual = veiculo.valor * 0.015;
    const licenciamentoAnual = custosFixosAnuaisData.licenciamento_anual[ufOrigem] || 150;
    const TI = (ipvaAnual + licenciamentoAnual) / 12;

    // SV, SE, RCF - MELHORADO: Utilizando a estimativa mensal do JSON.
    const SV_SE_RCF = veiculo.seguroMensalEstimado;

    const custoFixoMensalTotal = RC + SM + SO + RV + TI + SV_SE_RCF;
    
    return custoFixoMensalTotal;
}

/**
 * Calcula o Custo Variável por KM (CV) do veículo, conforme NTC (Cap. III).
 * @returns {number} O Custo Variável (CV) em R$/km.
 */
function calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem) {
    const quilometragemMensal = GLOBAL_HORAS_TRABALHADAS_MES * GLOBAL_VELOCIDADE_MEDIA_KMH;
    
    // PM = (Valor do veículo sem pneus * 1%) / KM Média Mensal
    const PM = (veiculo.valorSemPneus * 0.01) / quilometragemMensal;

    // DC (Combustível)
    const { precos, consumo_arla_percentual_sobre_diesel, consumo_diesel_kml } = custosVariaveisData; 
    const numEixos = veiculo.eixos;
    const precoDieselDoEstado = precosCombustivelData[ufOrigem]; 

    let rendimentoKmL = consumo_diesel_kml.outros[numEixos]; // Padrão
    if (consumo_diesel_kml.excecoes[tipoCarga] && consumo_diesel_kml.excecoes[tipoCarga][numEixos]) {
        rendimentoKmL = consumo_diesel_kml.excecoes[tipoCarga][numEixos];
    } else if (tipoCarga === 'frigorificada' || tipoCarga === 'perigosa_frigorificada') {
        rendimentoKmL = consumo_diesel_kml.frigorificada[numEixos];
    }
    
    const DC = precoDieselDoEstado / rendimentoKmL;

    // AD (Aditivo ARLA32)
    const litrosDieselPorKm = 1 / rendimentoKmL;
    const litrosArlaPorKm = litrosDieselPorKm * consumo_arla_percentual_sobre_diesel;
    const AD = litrosArlaPorKm * precos.arla32_litro;

    // LB (Lubrificantes) - Usando proxy do JSON para simplificar
    const LB = veiculo.custoLubrificantesPorKm; 

    // LG (Lavagem e graxas) - Usando proxy do JSON para simplificar
    const LG = veiculo.custoLavagemGraxasPorKm;

    // PR (Pneus e recauchutagem) - Fórmula NTC: {[(1 + %perda) x PneuNovo] + (Recap x N_Recap)} x N_Pneus / VidaUtilTotal
    const { preco_pneu_novo, recauchutagem, vida_util_km, numero_pneus } = custosPneusData;
    const precoDirecional = preco_pneu_novo.direcional[numEixos];
    const custoDirecionalPorKm = (precoDirecional / vida_util_km.direcional_sem_recauchutagem) * numero_pneus.direcionais;
    
    const precoTraseiro = preco_pneu_novo.traseiro[numEixos];
    const custoRecapagem = recauchutagem.preco * recauchutagem.numero_por_pneu_traseiro;
    const vidaUtilTraseiroTotal = vida_util_km.traseiro_com_recauchutagem * (1 + recauchutagem.numero_por_pneu_traseiro);
    const custoTotalPneuTraseiro = precoTraseiro + custoRecapagem;
    const numPneusTraseiros = (numEixos - 1) * numero_pneus.traseiros_por_eixo;
    const custoTraseiroPorKm = (custoTotalPneuTraseiro / vidaUtilTraseiroTotal) * numPneusTraseiros;

    const PR = (custoDirecionalPorKm + custoTraseiroPorKm);

    const custoVariavelPorKmTotal = PM + DC + AD + LB + LG + PR;

    return custoVariavelPorKmTotal;
}

/**
 * Calcula o frete-peso da NTC (Seu Custo Operacional Total).
 * Fórmula: F = (A + BX + DI) * (1 + L/100)
 * @returns {number} O valor do frete em R$ por tonelada.
 */
function calcularSeuCustoOperacionalTotalNTC(distanciaKm, veiculo, tipoCarga, ufOrigem) {
    if (!veiculo || !veiculo.capacidadeToneladas || veiculo.capacidadeToneladas <= 0) {
        throw new Error("Dados do veículo inválidos ou capacidade em toneladas não definida para o cálculo NTC.");
    }
    if (distanciaKm <= 0) {
        throw new Error("Distância inválida para o cálculo NTC.");
    }

    const cfMensal = calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem);
    const cvPorKm = calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem);
    const capacidadeTon = veiculo.capacidadeToneladas;
    
    // Fator A = (CF * Tcd) / (CAP * H)
    const fatorA = (cfMensal * GLOBAL_TEMPO_CARGA_DESCARGA_HORAS) / (capacidadeTon * GLOBAL_HORAS_TRABALHADAS_MES);

    // Fator B = [(CF / (H * V)) + CV] / CAP
    const fatorB = ((cfMensal / (GLOBAL_HORAS_TRABALHADAS_MES * GLOBAL_VELOCIDADE_MEDIA_KMH)) + cvPorKm) / capacidadeTon;

    // DI = (DAT_mensal / T.EXP) * C
    const diPorTonelada = (GLOBAL_DESPESAS_INDIRETAS_MENSAIS / GLOBAL_TONELAGEM_EXPEDIDA_MENSAL) * GLOBAL_COEFICIENTE_TERMINAIS;

    // Cálculo do Frete-peso por tonelada (Fórmula NTC)
    const fretePesoNTC_por_tonelada = (fatorA + (fatorB * distanciaKm) + diPorTonelada) * (1 + (GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL / 100));

    return fretePesoNTC_por_tonelada;
}


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

    const avisoMultiViagemElem = document.getElementById('aviso-multi-viagem');
    const distanciaVeiculoElem = document.getElementById('distancia-veiculo');
    const custoAnttValorElem = document.getElementById('custo-antt-valor');
    const custoAnttDetalheElem = document.getElementById('custo-antt-detalhe');
    const custoNtcValorElem = document.getElementById('custo-ntc-valor');
    const custoNtcDetalheElem = document.getElementById('custo-ntc-detalhe');
    const duracaoTotalValorElem = document.getElementById('duracao-total-valor');
    const duracaoTotalDetalheElem = document.getElementById('duracao-total-detalhe');
    const loadingMessageElem = document.getElementById('loading-message');
    const errorDisplayMessageElem = document.getElementById('error-display-message');

    // Limpeza da UI
    loadingMessageElem.style.display = 'none';
    avisoMultiViagemElem.style.display = 'none';
    distanciaVeiculoElem.style.display = 'none';
    custoAnttValorElem.parentElement.style.display = 'none';
    custoNtcValorElem.parentElement.style.display = 'none';
    duracaoTotalValorElem.parentElement.style.display = 'none';
    errorDisplayMessageElem.style.display = 'none';
    errorDisplayMessageElem.textContent = '';
    
    if (!origemInput || !destinoInput || !pesoCargaInput) {
        errorDisplayMessageElem.textContent = 'Por favor, preencha todos os campos.';
        errorDisplayMessageElem.style.display = 'block';
        return;
    }
    const pesoCarga = parseFloat(pesoCargaInput);
    if (isNaN(pesoCarga) || pesoCarga <= 0) {
        errorDisplayMessageElem.textContent = 'Por favor, insira um peso de carga válido.';
        errorDisplayMessageElem.style.display = 'block';
        return;
    }
    const veiculoSelecionado = veiculosData[veiculoId];
    if (!veiculoSelecionado) {
        errorDisplayMessageElem.textContent = 'Dados do veículo não carregados ou veículo selecionado inválido.';
        errorDisplayMessageElem.style.display = 'block';
        return;
    }
    
    loadingMessageElem.style.display = 'block';

    let numeroDeViagens = 1;
    if (pesoCarga > veiculoSelecionado.capacidadeToneladas) {
        numeroDeViagens = Math.ceil(pesoCarga / veiculoSelecionado.capacidadeToneladas);
        avisoMultiViagemElem.innerHTML = `<strong>Atenção:</strong> A carga de ${pesoCarga}t excede a capacidade útil do veículo (${veiculoSelecionado.capacidadeToneladas}t).<br>Serão necessárias <strong>${numeroDeViagens} viagens</strong>.`;
        avisoMultiViagemElem.style.display = 'block';
    }
    
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

        const ufOrigem = estadoParaUFData[origemInfo.estado];
        if (!ufOrigem) { throw new Error(`Não foi possível determinar a UF para o estado de origem: ${origemInfo.estado || 'desconhecido'}.`); }
        
        // --- CÁLCULO 1: Custo Mínimo (ANTT) ---
        const custoPorViagemANTT = calcularCustoFreteANTTOfficial(distanciaKm, veiculoSelecionado, tipoCarga, tipoOperacao);
        const custoTotalOperacaoANTT = custoPorViagemANTT.custoTotal * numeroDeViagens;

        // --- CÁLCULO 2: Seu Custo Operacional Total (NTC) ---
        const fretePesoPorToneladaNTC = calcularSeuCustoOperacionalTotalNTC(distanciaKm, veiculoSelecionado, tipoCarga, ufOrigem);
        const custoDeUmaViagemNTC = fretePesoPorToneladaNTC * veiculoSelecionado.capacidadeToneladas;
        const seuCustoOperacionalTotalNTC = custoDeUmaViagemNTC * numeroDeViagens;

        // --- Cálculos de Duração ---
        const duracaoRealistaPorViagem = calcularDuracaoRealista(tempoConducaoOriginalSegundos);
        const duracaoTotalOperacaoSegundos = duracaoRealistaPorViagem.duracaoTotalSegundos * numeroDeViagens;

        // --- Exibição dos Resultados ---
        routeLayer.clearLayers();
        loadingMessageElem.style.display = 'none';

        distanciaVeiculoElem.innerHTML = `<strong>Distância (por viagem):</strong> ${distanciaKm.toFixed(2)} km | <strong>Veículo:</strong> ${veiculoSelecionado.nome}`;
        distanciaVeiculoElem.style.display = 'block';

        custoAnttValorElem.textContent = `Custo Mínimo (ANTT): R$ ${custoTotalOperacaoANTT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        custoAnttDetalheElem.innerHTML = `Baseado em ${numeroDeViagens} viagem(ns) de R$ ${custoPorViagemANTT.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada (Tabela ${custoPorViagemANTT.tituloTabela}).`;
        custoAnttValorElem.parentElement.style.display = 'block';
        
        custoNtcValorElem.textContent = `Seu Custo Operacional Total (NTC): R$ ${seuCustoOperacionalTotalNTC.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        custoNtcDetalheElem.innerHTML = `Baseado em ${numeroDeViagens} viagem(ns) de R$ ${custoDeUmaViagemNTC.toLocaleString('pt-BR', {minimumFractionDigits: 2})} cada.<br>Calculado com base no Manual de Custos da NTC&Logística.`;
        custoNtcValorElem.parentElement.style.display = 'block';
        
        duracaoTotalValorElem.textContent = `Duração Total da Operação: ${formatarDuracao(duracaoTotalOperacaoSegundos)}`;
        duracaoTotalDetalheElem.innerHTML = `Considerando ${numeroDeViagens} viagem(ns) de ${formatarDuracao(duracaoRealistaPorViagem.duracaoTotalSegundos)} cada.<br><small><em>(Cada viagem inclui aprox. ${duracaoRealistaPorViagem.paradas11h} pernoite(s) e ${duracaoRealistaPorViagem.paradas30min} parada(s) de 30min)</em></small>`;
        duracaoTotalValorElem.parentElement.style.display = 'block';
        
        const routeGeometry = routeData.routes[0].geometry;
        const routeLine = L.geoJSON(routeGeometry, { style: { color: '#0056b3', weight: 6 } }).addTo(routeLayer);
        L.marker([origemInfo.lat, origemInfo.lon]).addTo(routeLayer).bindPopup(`<b>Saída:</b><br>${origemAddressText}`);
        L.marker([destinoInfo.lat, destinoInfo.lon]).addTo(routeLayer).bindPopup(`<b>Chegada:</b><br>${destinoInfo.address || destinoAddressText}`);
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        loadingMessageElem.style.display = 'none';
        errorDisplayMessageElem.textContent = `Falha ao processar a solicitação. ${error.message}`;
        errorDisplayMessageElem.style.display = 'block';
        console.error("Erro na função calculateAndDisplayRoute:", error);
    }
}