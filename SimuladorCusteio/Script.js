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
const GLOBAL_VELOCIDADE_MEDIA_KMH = 60; // V: Velocidade média de transporte em km/h
const GLOBAL_COEFICIENTE_TERMINAIS = 1; // C: Coeficiente de uso de terminais (valor médio = 1)
const GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL = 15; // L: Lucro operacional em percentual (ex: 15 para 15% de lucro)
const GLOBAL_TEMPO_CARGA_DESCARGA_HORAS = 3; // Tcd: Tempo de carga e descarga em horas (para lotação, 3h é um exemplo)
const GLOBAL_DESPESAS_INDIRETAS_MENSAIS = 50000; // DI_mensal: Despesas administrativas e de terminais mensais (DAT)
const GLOBAL_TONELAGEM_EXPEDIDA_MENSAL = 1000; // T_EXP: Tonelagem expedida pela empresa no mês (para rateio do DI)


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
// FUNÇÕES DE CÁLCULO ANTT (TABELA OFICIAL)
// =================================================================
// Esta é a função original para o CUSTO MÍNIMO ANTT (usando tabela-antt-2024.json)
function calcularCustoFreteANTTOfficial(distanciaKm, veiculo, tipoCarga, tipoOperacao) {
    const numEixos = veiculo.eixos;
    const tabelaSelecionada = tabelaAnttData[tipoOperacao];
    if (!tabelaSelecionada) { throw new Error("Tipo de operação (Tabela ANTT) inválido."); }
    const coeficientes = tabelaSelecionada.cargas[tipoCarga]?.[numEixos];
    if (!coeficientes || coeficientes.ccd === null) { throw new Error(`Combinação inválida: Não há valor na ${tabelaSelecionada.titulo} para o tipo de carga selecionado com um veículo de ${numEixos} eixos.`); }
    
    const custoDeslocamento = distanciaKm * coeficientes.ccd;
    const custoCargaDescarga = coeficientes.cc;
    const custoTotal = custoDeslocamento + custoCargaDescarga; // Cálculo apenas do valor de ida
    
    return { custoTotal: custoTotal, tituloTabela: tabelaSelecionada.titulo };
}

// =================================================================
// FUNÇÕES DE CÁLCULO NTC (SEU CUSTO OPERACIONAL TOTAL - Baseado no Manual NTC 2014)
// =================================================================

// Função para calcular o Custo Fixo Mensal (CF) do veículo, conforme NTC (Cap. III do manual)
function calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem) {
    // RC (Remuneração mensal do capital)
    // Assumindo taxa de remuneração anual de 12% (1% ao mês)
    const taxaRemuneracaoMensal = 0.01; 
    const RC = veiculo.valor * taxaRemuneracaoMensal; 

    // SM (Salário do motorista)
    // Inclui salário base + encargos sociais
    const SM = veiculo.salarioMotoristaMensal * (1 + veiculo.encargosSociaisMotorista);

    // SO (Salários de oficina)
    // Simplificado. O manual calcula para a frota. Aqui, usaremos o custoManutencaoMensal do veículo como uma proxy.
    const SO_por_veiculo_estimado = veiculo.custoManutencaoMensal; 

    // RV (Reposição de veículo ou Depreciação do Veículo)
    const valorVeiculoSemPneus = veiculo.valorSemPneus; // Já está no JSON
    const vidaUtilMeses = veiculo.vidaUtilAnos * 12;
    const RV = (0.95 * valorVeiculoSemPneus) / vidaUtilMeses; // 95% de perda, 5% de valor de revenda

    // TI (Taxas e Impostos sobre o Veículo)
    // IPVA, DPVAT, Licenciamento. (O `custosFixosAnuaisData.licenciamento_anual` aqui é um proxy para todas as taxas anuais)
    const taxaLicenciamentoAnual = custosFixosAnuaisData.licenciamento_anual[ufOrigem] || 0;
    const TI = taxaLicenciamentoAnual / 12; // Mensalizando

    // SV (Seguro do veículo), SE (Seguro do equipamento), RCF (Seguro de Responsabilidade Civil Facultativo)
    // Usando a estimativa mensal do veiculo.json para simplificar as complexas fórmulas da NTC.
    const SV_SE_RCF = veiculo.seguroMensalEstimado;

    // CF = RC + SM + SO + RV + RE (se aplicável) + TI + SV + SE + RCF
    // RE (Reposição do equipamento/implemento) não está separado aqui, assumido como parte do RV se o 'valor' do veículo é do conjunto.
    const custoFixoMensalTotal = RC + SM + SO_por_veiculo_estimado + RV + TI + SV_SE_RCF;

    return custoFixoMensalTotal;
}

// Função para calcular o Custo Variável por KM (CV) do veículo, conforme NTC (Cap. III do manual)
function calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem) {
    // PM (Peças, acessórios e material de manutenção)
    // NTC: (Valor do veículo completo sem pneus * % de peças) / Quilometragem média mensal
    // Simplificando: custoManutencaoMensal do veículo dividido pela quilometragem mensal de trabalho.
    const quilometragemMensal = GLOBAL_HORAS_TRABALHADAS_MES * GLOBAL_VELOCIDADE_MEDIA_KMH;
    const PM = veiculo.custoManutencaoMensal / quilometragemMensal;

    // DC (Combustível)
    const { precos, consumo_arla_percentual_sobre_diesel, consumo_diesel_kml } = custosVariaveisData; 
    const numEixos = veiculo.eixos;
    const precoDieselDoEstado = precosCombustivelData[ufOrigem]; 

    let rendimentoKmL = 0;
    if (consumo_diesel_kml.excecoes[tipoCarga] && consumo_diesel_kml.excecoes[tipoCarga][numEixos]) {
        rendimentoKmL = consumo_diesel_kml.excecoes[tipoCarga][numEixos];
    } else {
        const tabelaConsumo = (tipoCarga === 'frigorificada' || tipoCarga === 'perigosa_frigorificada') ? consumo_diesel_kml.frigorificada : consumo_diesel_kml.outros;
        rendimentoKmL = tabelaConsumo[numEixos];
    }
    if (!rendimentoKmL || rendimentoKmL === 0) {
        throw new Error(`Não foi possível encontrar o rendimento de combustível para um veículo de ${numEixos} eixos com carga ${tipoCarga}.`);
    }

    const DC = precoDieselDoEstado / rendimentoKmL; // R$/km

    // AD (Aditivo ARLA32)
    const litrosDieselPorKm = 1 / rendimentoKmL;
    const litrosArlaPorKm = litrosDieselPorKm * consumo_arla_percentual_sobre_diesel;
    const AD = litrosArlaPorKm * precos.arla32_litro;

    // LB (Lubrificantes)
    // Usando o custo por km do veículo, simplificando as fórmulas detalhadas da NTC.
    const LB = veiculo.custoLubrificantesPorKm;

    // LG (Lavagem e graxas)
    // Usando o custo por km do veículo, simplificando as fórmulas detalhadas da NTC.
    const LG = veiculo.custoLavagemGraxasPorKm;

    // PR (Pneus e recauchutagem)
    // Usando o custo por km do veículo, simplificando a complexa fórmula da NTC.
    const PR = veiculo.custoPneuPorKm;

    // CV = PM + DC + AD + LB + LG + PR
    const custoVariavelPorKmTotal = PM + DC + AD + LB + LG + PR;

    return custoVariavelPorKmTotal;
}

// Função para calcular as Despesas Indiretas por Tonelada (DI), conforme NTC (Cap. IV do manual)
function calcularDespesasIndiretasPorToneladaNTC(despesasIndiretasMensais, tonelagemExpedidaMensal, coeficienteUsoTerminais) {
    if (tonelagemExpedidaMensal <= 0) {
        console.warn("Tonelagem expedida mensal é zero ou negativa para o cálculo NTC. DI será 0.");
        return 0;
    }
    // DI = (DI_mensal / T.EXP) * C
    return (despesasIndiretasMensais / tonelagemExpedidaMensal) * coeficienteUsoTerminais;
}

// Função principal para calcular o SEU CUSTO OPERACIONAL TOTAL (NTC - Frete-peso Simplificado do manual, Cap. V, pág. 22)
// F = (A + BX + DI) * (1 + L/100)
function calcularSeuCustoOperacionalTotalNTC(distanciaKm, veiculo, tipoCarga, ufOrigem) {
    if (!veiculo || !veiculo.capacidadeToneladas || veiculo.capacidadeToneladas <= 0) {
        throw new Error("Dados do veículo inválidos ou capacidade em toneladas não definida para o cálculo NTC.");
    }
    if (!distanciaKm || distanciaKm <= 0) {
        throw new Error("Distância inválida para o cálculo NTC.");
    }

    // 1. Obter Custo Fixo Mensal (CF) do veículo
    const cfMensal = calcularCustoFixoMensalVeiculoNTC(veiculo, ufOrigem);

    // 2. Obter Custo Variável por KM (CV) do veículo
    const cvPorKm = calcularCustoVariavelPorKmNTC(veiculo, tipoCarga, ufOrigem);

    // 3. Calcular Fator A (Custo do tempo de espera na carga/descarga por tonelada)
    // A = (CF * Tcd) / (CAP * H)
    const tempoCargaDescargaHoras = GLOBAL_TEMPO_CARGA_DESCARGA_HORAS;
    const horasTrabalhadasPorMes = GLOBAL_HORAS_TRABALHADAS_MES;
    const capacidadeVeiculoTon = veiculo.capacidadeToneladas; 

    const fatorA = (cfMensal * tempoCargaDescargaHoras) / (capacidadeVeiculoTon * horasTrabalhadasPorMes);

    // 4. Calcular Fator B (Custo de transferência por t.km)
    // B = [(CF / (H * V)) + CV] * (1 / CAP)
    const velocidadeMediaKmH = GLOBAL_VELOCIDADE_MEDIA_KMH;
    const fatorB = ((cfMensal / (horasTrabalhadasPorMes * velocidadeMediaKmH)) + cvPorKm) * (1 / capacidadeVeiculoTon);

    // 5. Calcular Despesas Indiretas por Tonelada (DI)
    const diPorTonelada = calcularDespesasIndiretasPorToneladaNTC(
        GLOBAL_DESPESAS_INDIRETAS_MENSAIS,
        GLOBAL_TONELAGEM_EXPEDIDA_MENSAL,
        GLOBAL_COEFICIENTE_TERMINAIS
    );

    // 6. Lucro Operacional (L)
    const lucroPercentual = GLOBAL_LUCRO_OPERACIONAL_PERCENTUAL;

    // 7. Frete-peso (F) - Fórmula simplificada NTC (R$/tonelada)
    // F = (A + BX + DI) * (1 + L/100)
    const fretePesoNTC_por_tonelada = (fatorA + (fatorB * distanciaKm) + diPorTonelada) * (1 + (lucroPercentual / 100));

    return fretePesoNTC_por_tonelada; 
}

// =================================================================
// FUNÇÕES DE CÁLCULO DE DETALHAMENTO (SUAS FUNÇÕES ORIGINAIS)
// Estas funções são utilizadas para compor o detalhamento "Seu Custo Operacional Total"
// e não fazem parte direta da fórmula Frete-Peso NTC principal.
// =================================================================
function calcularCustoOperacionalFixo(veiculo, duracaoViagemDias, ufOrigem) {
    const depreciacaoAnual = veiculo.valor / veiculo.vidaUtilAnos;
    const depreciacaoMensal = depreciacaoAnual / 12;
    const custoFixoMensalTotal = depreciacaoMensal + veiculo.custoManutencaoMensal;
    const custoFixoDiario = custoFixoMensalTotal / 30;
    const custoDepreciacaoManutencaoViagem = custoFixoDiario * duracaoViagemDias;
    const taxaLicenciamentoAnual = custosFixosAnuaisData.licenciamento_anual[ufOrigem];
    let custoLicenciamentoViagem = 0;
    if (taxaLicenciamentoAnual) {
        const custoDiarioLicenciamento = taxaLicenciamentoAnual / 365;
        custoLicenciamentoViagem = custoDiarioLicenciamento * duracaoViagemDias;
    } else {
        console.warn(`Valor de licenciamento não encontrado para a UF: ${ufOrigem}. Custo não será adicionado.`);
    }
    return { custoTotalFixo: custoDepreciacaoManutencaoViagem + custoLicenciamentoViagem, depreciacaoViagem: (depreciacaoMensal / 30) * duracaoViagemDias, manutencaoViagem: (veiculo.custoManutencaoMensal / 30) * duracaoViagemDias, licenciamentoViagem: custoLicenciamentoViagem };
}

function calcularCustoSalario(salarioMensal, duracaoViagemSegundos) {
    const salarioDiario = salarioMensal / 21;
    const duracaoExataEmDias = duracaoViagemSegundos / 86400;
    const diasOcupados = Math.ceil(duracaoExataEmDias);
    const custoSalarioViagem = salarioDiario * diasOcupados;
    return custoSalarioViagem;
}

function calcularCustoVariavel(distanciaKm, veiculo, tipoCarga, ufOrigem) {
    const { precos, consumo_arla_percentual_sobre_diesel, consumo_diesel_kml } = custosVariaveisData;
    const numEixos = veiculo.eixos;
    const precoDieselDoEstado = precosCombustivelData[ufOrigem];
    if (!precoDieselDoEstado) { throw new Error(`Preço do diesel não encontrado para o estado ${ufOrigem}.`); }
    let rendimentoKmL = 0;
    if (consumo_diesel_kml.excecoes[tipoCarga] && consumo_diesel_kml.excecoes[tipoCarga][numEixos]) {
        rendimentoKmL = consumo_diesel_kml.excecoes[tipoCarga][numEixos];
    } else {
        const tabelaConsumo = (tipoCarga === 'frigorificada' || tipoCarga === 'perigosa_frigorificada') ? consumo_diesel_kml.frigorificada : consumo_diesel_kml.outros;
        rendimentoKmL = tabelaConsumo[numEixos];
    }
    if (!rendimentoKmL) { throw new Error(`Não foi possível encontrar o rendimento de combustível para um veículo de ${numEixos} eixos com carga ${tipoCarga}.`); }
    const litrosDiesel = distanciaKm / rendimentoKmL;
    const custoDiesel = litrosDiesel * precoDieselDoEstado;
    const litrosArla = litrosDiesel * consumo_arla_percentual_sobre_diesel;
    const custoArla = litrosArla * precos.arla32_litro;
    return { custoTotalVariavel: custoDiesel + custoArla, custoDiesel: custoDiesel, custoArla: custoArla };
}

function calcularCustoPneus(distanciaKm, veiculo) {
    const numEixos = veiculo.eixos;
    const precoPneuDirecional = custosPneusData.preco_pneu_novo.direcional[numEixos];
    const vidaUtilDirecional = custosPneusData.vida_util_km.direcional_sem_recauchutagem;
    const custoKmPneuDirecional = precoPneuDirecional / vidaUtilDirecional;
    const custoTotalDirecionais = custoKmPneuDirecional * custosPneusData.numero_pneus.direcionais;
    const precoPneuTraseiro = custosPneusData.preco_pneu_novo.traseiro[numEixos];
    const custoRecauchutagem = custosPneusData.recauchutagem.preco * custosPneusData.recauchutagem.numero_por_pneu_traseiro;
    const vidaUtilTraseiro = custosPneusData.vida_util_km.traseiro_com_recauchutagem;
    const custoTotalVidaPneuTraseiro = precoPneuTraseiro + custoRecauchutagem;
    const custoKmPneuTraseiro = custoTotalVidaPneuTraseiro / vidaUtilTraseiro;
    const eixosTraseiros = numEixos - 1;
    const numeroPneusTraseiros = eixosTraseiros > 0 ? eixosTraseiros * custosPneusData.numero_pneus.traseiros_por_eixo : 0;
    const custoTotalTraseiros = custoKmPneuTraseiro * numeroPneusTraseiros;
    const custoTotalPneusPorKm = custoTotalDirecionais + custoTotalTraseiros;
    const custoPneusParaViagem = custoTotalPneusPorKm * distanciaKm;
    return custoPneusParaViagem;
}


// =================================================================
// 5. FUNÇÃO PRINCIPAL (ORQUESTRADOR)
// =================================================================
async function calculateAndDisplayRoute() {
    // Obter e validar inputs
    const origemInput = document.getElementById('origem').value;
    const destinoInput = document.getElementById('destino').value;
    const tipoOperacao = document.getElementById('tipo-operacao').value; // Ex: 'fracionada', 'lotacao'
    const tipoCarga = document.getElementById('tipo-carga').value;     // Ex: 'seca', 'frigorificada', 'perigosa'
    const veiculoId = document.getElementById('veiculo').value;
    const pesoCargaInput = document.getElementById('peso-carga').value;

    // Limpar mensagens de erro e resultados anteriores
    document.getElementById('resultados').innerHTML = ''; // Limpa tudo antes de preencher
    document.getElementById('aviso-multi-viagem').style.display = 'none'; // Esconde o aviso por padrão
    document.getElementById('distancia-veiculo').innerHTML = '';
    document.getElementById('custo-antt-valor').textContent = '';
    document.getElementById('custo-antt-detalhe').textContent = '';
    document.getElementById('custo-ntc-valor').textContent = '';
    document.getElementById('custo-ntc-detalhe').textContent = '';
    document.getElementById('duracao-total-valor').textContent = '';
    document.getElementById('duracao-total-detalhe').textContent = '';


    if (!origemInput || !destinoInput || !pesoCargaInput) {
        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Por favor, preencha todos os campos.</div>`;
        return;
    }
    const pesoCarga = parseFloat(pesoCargaInput);
    if (isNaN(pesoCarga) || pesoCarga <= 0) {
        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Por favor, insira um peso de carga válido.</div>`;
        return;
    }
    const veiculoSelecionado = veiculosData[veiculoId];
    if (!veiculoSelecionado) {
        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Dados do veículo não carregados ou veículo selecionado inválido.</div>`;
        return;
    }

    let numeroDeViagens = 1;
    // CORREÇÃO AQUI: A mensagem de aviso usa 'capacidadeToneladas', que é a carga útil
    if (pesoCarga > veiculoSelecionado.capacidadeToneladas) {
        numeroDeViagens = Math.ceil(pesoCarga / veiculoSelecionado.capacidadeToneladas);
        document.getElementById('aviso-multi-viagem').innerHTML = `<strong>Atenção:</strong> A carga de ${pesoCarga}t excede a capacidade útil do veículo (${veiculoSelecionado.capacidadeToneladas}t).<br>Serão necessárias <strong>${numeroDeViagens} viagens</strong>.`;
        document.getElementById('aviso-multi-viagem').style.display = 'block';
    }
    
    // Mensagem de processamento
    document.getElementById('distancia-veiculo').innerHTML = '<strong>Processando e calculando...</strong>';


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

        // --- Obtenção da UF de origem para os cálculos dependentes de estado ---
        const ufOrigem = estadoParaUFData[origemInfo.estado];
        if (!ufOrigem) { throw new Error(`Não foi possível determinar a UF para o estado de origem: ${origemInfo.estado || 'desconhecido'}.`); }
        
        // --- CÁLCULO 1: Custo Mínimo (ANTT) ---
        // Utiliza sua função original 'calcularCustoFreteANTTOfficial' com 'tabelaAnttData'
        const custoPorViagemANTT = calcularCustoFreteANTTOfficial(distanciaKm, veiculoSelecionado, tipoCarga, tipoOperacao);
        const custoTotalOperacaoANTT = custoPorViagemANTT.custoTotal * numeroDeViagens;

        // --- CÁLCULO 2: Seu Custo Operacional Total (NTC) ---
        // Utiliza as novas funções baseadas nas fórmulas do Manual NTC
        const fretePesoPorToneladaNTC = calcularSeuCustoOperacionalTotalNTC(distanciaKm, veiculoSelecionado, tipoCarga, ufOrigem);
        const seuCustoOperacionalTotalNTC = fretePesoPorToneladaNTC * pesoCarga;

        // --- Cálculos auxiliares para detalhamento do "Seu Custo Operacional Total" ---
        // Estas funções são as suas funções originais, utilizadas para compor o detalhamento
        const duracaoRealistaPorViagem = calcularDuracaoRealista(tempoConducaoOriginalSegundos);
        const duracaoViagemEmDias = duracaoRealistaPorViagem.duracaoTotalSegundos / 86400; // Dias com pernoites e paradas
        
        const custoFixoPorViagemParaDetalhe = calcularCustoOperacionalFixo(veiculoSelecionado, duracaoViagemEmDias, ufOrigem);
        const salarioMensalBase = salariosData[ufOrigem];
        const custoSalarioPorViagemParaDetalhe = calcularCustoSalario(salarioMensalBase, duracaoRealistaPorViagem.duracaoTotalSegundos);
        const custoVariavelPorViagemParaDetalhe = calcularCustoVariavel(distanciaKm, veiculoSelecionado, tipoCarga, ufOrigem);
        const custoPneusPorViagemParaDetalhe = calcularCustoPneus(distanciaKm, veiculoSelecionado);

        const duracaoTotalOperacaoSegundos = duracaoRealistaPorViagem.duracaoTotalSegundos * numeroDeViagens;

        // --- Exibição dos Resultados (Preenchendo os elementos HTML) ---
        routeLayer.clearLayers();
        
        document.getElementById('distancia-veiculo').innerHTML = `<strong>Distância (por viagem):</strong> ${distanciaKm.toFixed(2)} km | <strong>Veículo:</strong> ${veiculoSelecionado.nome}`;

        document.getElementById('custo-antt-valor').textContent = `Custo Mínimo (ANTT): R$ ${custoTotalOperacaoANTT.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('custo-antt-detalhe').innerHTML = `Baseado em ${numeroDeViagens} viagem(ns) de R$ ${custoPorViagemANTT.custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} cada (Tabela ${custoPorViagemANTT.tituloTabela}).`;
        
        document.getElementById('custo-ntc-valor').textContent = `Seu Custo Operacional Total (NTC): R$ ${seuCustoOperacionalTotalNTC.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('custo-ntc-detalhe').innerHTML = `
            Considerando o peso total da carga.<br>
            Detalhes (por viagem):<br>
            Combustível: R$ ${custoVariavelPorViagemParaDetalhe.custoDiesel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
            Pneus: R$ ${custoPneusPorViagemParaDetalhe.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
            Salário: R$ ${custoSalarioPorViagemParaDetalhe.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | 
            Fixos (Outros): R$ ${custoFixoPorViagemParaDetalhe.custoTotalFixo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        `;
        
        document.getElementById('duracao-total-valor').textContent = `Duração Total da Operação: ${formatarDuracao(duracaoTotalOperacaoSegundos)}`;
        document.getElementById('duracao-total-detalhe').innerHTML = `
            Considerando ${numeroDeViagens} viagem(ns) de ${formatarDuracao(duracaoRealistaPorViagem.duracaoTotalSegundos)} cada.<br>
            <small><em>(Cada viagem inclui aprox. ${duracaoRealistaPorViagem.paradas11h} pernoite(s) e ${duracaoRealistaPorViagem.paradas30min} parada(s) de 30min)</em></small>
        `;
        
        const routeGeometry = routeData.routes[0].geometry;
        const routeLine = L.geoJSON(routeGeometry, { style: { color: '#0056b3', weight: 6 } }).addTo(routeLayer);
        L.marker([origemInfo.lat, origemInfo.lon]).addTo(routeLayer).bindPopup(`<b>Saída:</b><br>${origemAddressText}`);
        L.marker([destinoInfo.lat, destinoInfo.lon]).addTo(routeLayer).bindPopup(`<b>Chegada:</b><br>${destinoAddressText}`);
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        // Limpa todos os resultados e exibe a mensagem de erro
        document.getElementById('distancia-veiculo').innerHTML = '';
        document.getElementById('custo-antt-valor').textContent = '';
        document.getElementById('custo-antt-detalhe').textContent = '';
        document.getElementById('custo-ntc-valor').textContent = '';
        document.getElementById('custo-ntc-detalhe').textContent = '';
        document.getElementById('duracao-total-valor').textContent = '';
        document.getElementById('duracao-total-detalhe').textContent = '';
        document.getElementById('aviso-multi-viagem').style.display = 'none';

        document.getElementById('resultados').innerHTML = `<div class="resultado-bloco error-message">Falha ao processar a solicitação. ${error.message}</div>`;
        console.error("Erro na função calculateAndDisplayRoute:", error);
    }
}


// =================================================================
// 6. EVENT LISTENER (Ponto de Entrada)
// =================================================================
document.getElementById('calcular-rota').addEventListener('click', calculateAndDisplayRoute);