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

// Constantes Globais para o CÁLCULO NTC
const GLOBAL_HORAS_TRABALHADAS_MES = 220;
const GLOBAL_VELOCIDADE_MEDIA_KMH = 60;
const GLOBAL_COEFICIENTE_TERMINAIS = 1.0;
const GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL = 15;
const GLOBAL_TEMPO_CARGA_DESCARGA_HORAS = 3;
const GLOBAL_DESPESAS_INDIRETAS_MENSAIS = 50000;
const GLOBAL_TONELAGEM_EXPEDIDA_MENSAL = 1000;
const GLOBAL_TAXA_REMUNERACAO_CAPITAL_ANUAL = 0.12;
const GLOBAL_PERCENTUAL_PERDA_DEPRECIACAO = 0.95;

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
        
        const calcularRotaBtn = document.getElementById('calcular-rota');
        if (calcularRotaBtn) {
            calcularRotaBtn.addEventListener('click', calculateAndDisplayRoute);
        }

    } catch (error) {
        console.error("Falha ao carregar dados iniciais:", error);
        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Falha ao carregar dados. ${error.message}</div>`;
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
// 3. FUNÇÕES DE API E UTILITÁRIAS
// =================================================================
async function geocodeAddress(address) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&addressdetails=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.length > 0) {
        const details = data[0];
        const estado = (details.address && details.address.state) ? details.address.state : '';
        return { lat: details.lat, lon: details.lon, estado: estado };
    } else { throw new Error(`Endereço não encontrado: "${address}"`); }
}

async function fetchAddressFromCep(cep) {
    const url = `https://viacep.com.br/ws/${cep}/json/`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.erro) { throw new Error('CEP não encontrado.'); }
    return `${data.logradouro}, ${data.bairro}, ${data.localidade} - ${data.uf}`;
}

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
// 4. FUNÇÕES DE CÁLCULO
// =================================================================

function calcularCustoFreteANTTOfficial(distanciaKm, veiculo, tipoCarga, tipoOperacao) {
    const numEixos = veiculo.eixos;
    const tabelaSelecionada = tabelaAnttData[tipoOperacao];
    if (!tabelaSelecionada) { throw new Error("Tipo de operação (Tabela ANTT) inválido."); }
    const coeficientes = tabelaSelecionada.cargas[tipoCarga]?.[numEixos];
    if (!coeficientes || coeficientes.ccd === null) { throw new Error(`Combinação inválida: Não há valor na ${tabelaSelecionada.titulo} para o tipo de carga com ${numEixos} eixos.`); }
    
    let custoDeslocamento = distanciaKm * coeficientes.ccd;
    const custoCargaDescarga = coeficientes.cc;

    if (tipoOperacao === 'tabela_a' || tipoOperacao === 'tabela_c') {
        custoDeslocamento *= 2;
    }

    const custoTotal = custoDeslocamento + custoCargaDescarga;
    
    return { custoTotal: custoTotal, tituloTabela: tabelaSelecionada.titulo };
}

function calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem) {
    // RC = Valor do veículo completo x (taxa remuneração anual / 12)
    // O capital empatado considera o valor do conjunto (veículo + implemento)
    const valorTotalConjunto = veiculo.valor + veiculo.valorImplemento;
    const RC = valorTotalConjunto * (GLOBAL_TAXA_REMUNERACAO_CAPITAL_ANUAL / 12);

    // SM = (1 + % Encargos Sociais) x salário do motorista x nº motoristas
    const salarioBase = salariosData[ufOrigem] || veiculo.salarioMotoristaMensal;
    const SM = (1 + veiculo.encargosSociaisMotorista) * salarioBase * 1;

    // SO (Salários de oficina) - Simplificado
    const SO = (valorTotalConjunto * 0.003); 

    // RV = (% de perda x valor do VEÍCULO zero km sem pneus) / Vida Útil em meses [cite: 81]
    const RV = (GLOBAL_PERCENTUAL_PERDA_DEPRECIACAO * veiculo.valorSemPneus) / (veiculo.vidaUtilAnos * 12);

    // RE = (% de perda x valor do EQUIPAMENTO novo sem pneus) / Vida Útil em meses [cite: 85]
    let RE = 0;
    if (veiculo.valorImplemento > 0 && veiculo.vidaUtilImplementoAnos > 0) {
        RE = (GLOBAL_PERCENTUAL_PERDA_DEPRECIACAO * veiculo.valorImplementoSemPneus) / (veiculo.vidaUtilImplementoAnos * 12);
    }

    // TI = (IPVA + DPVAT + Licenciamento) / 12 [cite: 87]
    const ipvaAnual = valorTotalConjunto * 0.015; // [cite: 94]
    const licenciamentoAnual = custosFixosAnuaisData.licenciamento_anual[ufOrigem] || 150;
    const TI = (ipvaAnual + licenciamentoAnual) / 12; 

    // SV, SE, RCF - Simplificado como um % do valor do conjunto
    const SV_SE_RCF = (valorTotalConjunto * 0.04) / 12;

    // Soma de todos os custos fixos mensais [cite: 105]
    const custoFixoMensalTotal = RC + SM + SO + RV + RE + TI + SV_SE_RCF;
    
    return custoFixoMensalTotal;
}

function calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem) {
    const quilometragemMensal = GLOBAL_HORAS_TRABALHADAS_MES * GLOBAL_VELOCIDADE_MEDIA_KMH;
    const numEixos = veiculo.eixos;
    const custosVar = veiculo.custosVariaveis || {};

    const PM = (veiculo.valorSemPneus * 0.01) / quilometragemMensal;

    const { precos, consumo_arla_percentual_sobre_diesel, consumo_diesel_kml } = custosVariaveisData;
    const precoDieselDoEstado = precosCombustivelData[ufOrigem];
    let rendimentoKmL = consumo_diesel_kml.outros[numEixos];
    if (consumo_diesel_kml.excecoes[tipoCarga]?.[numEixos]) {
        rendimentoKmL = consumo_diesel_kml.excecoes[tipoCarga][numEixos];
    } else if (tipoCarga === 'frigorificada' || tipoCarga === 'perigosa_frigorificada') {
        rendimentoKmL = consumo_diesel_kml.frigorificada[numEixos];
    }
    const DC = precoDieselDoEstado / rendimentoKmL;
    const litrosDieselPorKm = 1 / rendimentoKmL;
    const litrosArlaPorKm = litrosDieselPorKm * consumo_arla_percentual_sobre_diesel;
    const AD = litrosArlaPorKm * precos.arla32_litro;

    const taxaReposicaoPorKm = (custosVar.taxa_reposicao_oleo_motor_l_por_1000km || 1) / 1000.0;
    const LM = (custosVar.preco_lubrificante_motor_litro || 35) * (((custosVar.volume_carter_litros || 40) / (custosVar.km_troca_oleo_motor || 20000)) + taxaReposicaoPorKm);
    const LT = ((custosVar.volume_transmissao_litros || 20) * (custosVar.preco_lubrificante_transmissao_litro || 45)) / (custosVar.km_troca_oleo_transmissao || 80000);
    const LB = LM + LT;

    const LG = (custosVar.preco_lavagem_completa || 150) / (custosVar.km_entre_lavagens || 5000);

    const { preco_pneu_novo, recauchutagem, vida_util_km, numero_pneus } = custosPneusData;
    const percentualPerdaPneus = custosVar.percentual_perda_pneus || 0.07;

    const precoDirecional = preco_pneu_novo.direcional[numEixos];
    const custoTotalCicloDirecional = (1 + percentualPerdaPneus) * precoDirecional;
    const custoDirecionalPorKm = (custoTotalCicloDirecional / vida_util_km.direcional_sem_recauchutagem);

    const precoTraseiro = preco_pneu_novo.traseiro[numEixos];
    const custoTotalRecapagens = recauchutagem.preco * recauchutagem.numero_por_pneu_traseiro;
    const custoTotalCicloTraseiro = ((1 + percentualPerdaPneus) * precoTraseiro) + custoTotalRecapagens;
    const vidaUtilTotalTraseiro = vida_util_km.traseiro_com_recauchutagem * (1 + recauchutagem.numero_por_pneu_traseiro);
    const custoTraseiroPorKm = (custoTotalCicloTraseiro / vidaUtilTotalTraseiro);

    const numPneusDirecionais = numero_pneus.direcionais;
    const numPneusTraseiros = (numEixos - 1) * numero_pneus.traseiros_por_eixo;
    const PR = (custoDirecionalPorKm * numPneusDirecionais) + (custoTraseiroPorKm * numPneusTraseiros);
    
    const custoVariavelPorKmTotal = PM + DC + AD + LB + LG + PR;

    return custoVariavelPorKmTotal;
}

function calcularFretePesoNTC(distanciaKm, veiculo, tipoCarga, ufOrigem) {
    const cfMensal = calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem);
    const cvPorKm = calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem);
    const capacidadeTon = veiculo.capacidadeToneladas;
    
    const fatorA = (cfMensal * GLOBAL_TEMPO_CARGA_DESCARGA_HORAS) / (capacidadeTon * GLOBAL_HORAS_TRABALHADAS_MES);
    const fatorB = ((cfMensal / (GLOBAL_HORAS_TRABALHADAS_MES * GLOBAL_VELOCIDADE_MEDIA_KMH)) + cvPorKm) / capacidadeTon;
    const diPorTonelada = (GLOBAL_DESPESAS_INDIRETAS_MENSAIS / GLOBAL_TONELAGEM_EXPEDIDA_MENSAL) * GLOBAL_COEFICIENTE_TERMINAIS;

    const custoFretePeso = fatorA + (fatorB * distanciaKm) + diPorTonelada;
    return custoFretePeso;
}

// =================================================================
// 5. FUNÇÃO PRINCIPAL (ORQUESTRADOR) - ATUALIZADA
// =================================================================

// Nova função auxiliar para buscar a alíquota do Frete-Valor conforme o manual 
function getFreteValorAliquota(distanciaKm) {
    if (distanciaKm <= 250) return 0.003;
    if (distanciaKm <= 500) return 0.004;
    if (distanciaKm <= 1000) return 0.006;
    if (distanciaKm <= 1500) return 0.007;
    if (distanciaKm <= 2000) return 0.008;
    if (distanciaKm <= 2600) return 0.009;
    if (distanciaKm <= 3000) return 0.010;
    if (distanciaKm <= 3400) return 0.011;
    // Acima de 3400 km
    return 0.012;
}


async function calculateAndDisplayRoute() {
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

    loadingMessageElem.style.display = 'none';
    avisoMultiViagemElem.style.display = 'none';
    distanciaVeiculoElem.style.display = 'none';
    if (custoAnttValorElem) custoAnttValorElem.parentElement.style.display = 'none';
    if (custoNtcValorElem) custoNtcValorElem.parentElement.style.display = 'none';
    if (duracaoTotalValorElem) duracaoTotalValorElem.parentElement.style.display = 'none';
    errorDisplayMessageElem.style.display = 'none';
    errorDisplayMessageElem.textContent = '';

    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoOperacao = document.getElementById('tipo-operacao').value;
    const tipoCarga = document.getElementById('tipo-carga').value;
    const veiculoId = document.getElementById('veiculo').value;
    const pesoCargaInput = document.getElementById('peso-carga').value;
    const valorCargaInput = document.getElementById('valor-carga').value; // CAMPO NOVO

    try {
        if (!origemInput || !destinoInput || !pesoCargaInput || !valorCargaInput) { // VALIDAÇÃO DO CAMPO NOVO
            throw new Error('Por favor, preencha todos os campos, incluindo o valor da carga.');
        }
        const pesoCarga = parseFloat(pesoCargaInput);
        const valorCarga = parseFloat(valorCargaInput); // CAMPO NOVO
        if (isNaN(pesoCarga) || pesoCarga <= 0) {
            throw new Error('Por favor, insira um peso de carga válido.');
        }
        if (isNaN(valorCarga) || valorCarga <= 0) { // VALIDAÇÃO DO CAMPO NOVO
            throw new Error('Por favor, insira um valor de carga válido.');
        }
        const veiculoSelecionado = veiculosData[veiculoId];
        if (!veiculoSelecionado) {
            throw new Error('Dados do veículo não carregados ou veículo selecionado inválido.');
        }

        loadingMessageElem.style.display = 'block';

        let numeroDeViagens = 1;
        if (pesoCarga > veiculoSelecionado.capacidadeToneladas) {
            numeroDeViagens = Math.ceil(pesoCarga / veiculoSelecionado.capacidadeToneladas);
            avisoMultiViagemElem.innerHTML = `<strong>Atenção:</strong> A carga de ${pesoCarga}t excede a capacidade do veículo (${veiculoSelecionado.capacidadeToneladas}t).<br>Serão necessárias <strong>${numeroDeViagens} viagens</strong>.`;
            avisoMultiViagemElem.style.display = 'block';
        }

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

        // --- CÁLCULO DOS CUSTOS ---

        // 1. Custo ANTT
        const custoPorViagemANTT = calcularCustoFreteANTTOfficial(distanciaKm, veiculoSelecionado, tipoCarga, tipoOperacao);
        const custoTotalOperacaoANTT = custoPorViagemANTT.custoTotal * numeroDeViagens;

        // 2. Custo NTC (Frete-Peso + Lucro + GRIS + Frete-Valor)
        const fretePesoPorToneladaNTC = calcularFretePesoNTC(distanciaKm, veiculoSelecionado, tipoCarga, ufOrigem);
        const custoFretePesoTotalViagem = fretePesoPorToneladaNTC * veiculoSelecionado.capacidadeToneladas;
        const lucroNTC = custoFretePesoTotalViagem * (GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL / 100);

        // CÁLCULO DO GRIS E FRETE-VALOR
        const valorCargaPorViagem = valorCarga / numeroDeViagens;
        const custoGris = valorCargaPorViagem * 0.003; // 
        const aliquotaFreteValor = getFreteValorAliquota(distanciaKm);
        const custoFreteValor = valorCargaPorViagem * aliquotaFreteValor; // 

        // SOMA TOTAL DO CUSTO NTC POR VIAGEM
        const custoDeUmaViagemNTC = custoFretePesoTotalViagem + lucroNTC + custoGris + custoFreteValor;
        const seuCustoOperacionalTotalNTC = custoDeUmaViagemNTC * numeroDeViagens;

        // 3. Duração
        const duracaoRealistaPorViagem = calcularDuracaoRealista(tempoConducaoOriginalSegundos);
        const duracaoTotalOperacaoSegundos = duracaoRealistaPorViagem.duracaoTotalSegundos * numeroDeViagens;

        // --- EXIBIÇÃO DOS RESULTADOS ---
        routeLayer.clearLayers();
        loadingMessageElem.style.display = 'none';

        distanciaVeiculoElem.innerHTML = `<strong>Distância (por viagem):</strong> ${distanciaKm.toFixed(2)} km | <strong>Veículo:</strong> ${veiculoSelecionado.nome}`;
        distanciaVeiculoElem.style.display = 'block';

        custoAnttValorElem.textContent = `Custo Mínimo (ANTT): R$ ${custoTotalOperacaoANTT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        custoAnttDetalheElem.innerHTML = `Baseado em ${numeroDeViagens} viagem(ns) de R$ ${custoPorViagemANTT.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada (Tabela: ${custoPorViagemANTT.tituloTabela}).`;
        custoAnttValorElem.parentElement.style.display = 'block';
        
        // Detalhamento do custo NTC atualizado
        const detalheNTC = `
            Baseado em ${numeroDeViagens} viagem(ns) de R$ ${custoDeUmaViagemNTC.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada.<br>
            <small>
                <b>Componentes por Viagem:</b><br>
                &bull; Frete-Peso: R$ ${custoFretePesoTotalViagem.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                &bull; GRIS (0.30%): R$ ${custoGris.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                &bull; Frete-Valor (${(aliquotaFreteValor * 100).toFixed(2)}%): R$ ${custoFreteValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br>
                &bull; Lucro (${GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL}%): R$ ${lucroNTC.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </small>`;
        
        custoNtcValorElem.textContent = `Preço Final Sugerido (NTC): R$ ${seuCustoOperacionalTotalNTC.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        custoNtcDetalheElem.innerHTML = detalheNTC;
        custoNtcValorElem.parentElement.style.display = 'block';

        duracaoTotalValorElem.textContent = `Duração Total da Operação: ${formatarDuracao(duracaoTotalOperacaoSegundos)}`;
        duracaoTotalDetalheElem.innerHTML = `Considerando ${numeroDeViagens} viagem(ns) de ${formatarDuracao(duracaoRealistaPorViagem.duracaoTotalSegundos)} cada.<br><small><em>(Cada viagem inclui aprox. ${duracaoRealistaPorViagem.paradas11h} pernoite(s) e ${duracaoRealistaPorViagem.paradas30min} parada(s) de 30min)</em></small>`;
        duracaoTotalValorElem.parentElement.style.display = 'block';

        const routeGeometry = routeData.routes[0].geometry;
        const routeLine = L.geoJSON(routeGeometry, { style: { color: '#0056b3', weight: 6 } });
        routeLayer.addLayer(routeLine);
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