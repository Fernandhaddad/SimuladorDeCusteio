// =================================================================
// 1. INICIALIZAÇÃO DO MAPA E CAMADAS
// =================================================================

const map = L.map('map').setView([-14.235, -51.925], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const routeLayer = L.layerGroup().addTo(map);

// =================================================================
// 2. FUNÇÕES DE LÓGICA DA INTERFACE (Adicionar e Remover Paradas)
// =================================================================

const paradasContainer = document.getElementById('pontos-de-parada-container');
let paradaCount = 1;

function adicionarCampoParada() {
    paradaCount++;
    const paradaGroup = document.createElement('div');
    paradaGroup.className = 'parada-group';

    const novoInput = document.createElement('input');
    novoInput.type = 'text';
    novoInput.className = 'ponto-parada';
    novoInput.placeholder = `Endereço da Parada ${paradaCount}`;
    
    const botaoRemover = document.createElement('button');
    botaoRemover.type = 'button';
    botaoRemover.className = 'remover-parada';
    botaoRemover.innerText = 'X';
    botaoRemover.onclick = () => {
        paradaGroup.remove();
    };
    
    paradaGroup.appendChild(novoInput);
    paradaGroup.appendChild(botaoRemover);
    paradasContainer.appendChild(paradaGroup);
}

// =================================================================
// 3. FUNÇÕES DE API (Geocodificação e Rotas)
// =================================================================

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

async function fetchRoute(coordsArray) {
    const profile = 'driving';
    const coordsString = coordsArray.map(c => `${c.lon},${c.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/${profile}/${coordsString}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();
        if (data.code !== 'Ok') {
            throw new Error(data.message || 'Não foi possível calcular a rota via OSRM.');
        }
        return data.routes[0];
    } catch (error) {
        console.error('Erro ao buscar rota no OSRM:', error);
        throw error;
    }
}

// =================================================================
// 4. FUNÇÃO PRINCIPAL DO ROTEIRIZADOR (VERSÃO SOLICITADA + NÚMEROS)
// =================================================================

async function criarRotaNoMapa() {
    routeLayer.clearLayers();
    const infoRotaDiv = document.getElementById('info-rota');
    infoRotaDiv.innerHTML = 'Processando...';

    const saidaInput = document.getElementById('ponto-saida').value;
    const paradaInputs = document.querySelectorAll('.ponto-parada');

    if (!saidaInput || Array.from(paradaInputs).some(input => !input.value)) {
        alert('Por favor, preencha todos os campos de endereço.');
        infoRotaDiv.innerHTML = '';
        return;
    }

    let todosEnderecos = [saidaInput, ...Array.from(paradaInputs).map(input => input.value)];
    const retornarOrigem = document.getElementById('retornar-origem').checked;

    try {
        let geocodePromises = todosEnderecos.map(addr => geocodeAddress(addr));
        let todasCoordenadas = await Promise.all(geocodePromises);

        if (retornarOrigem) {
            todosEnderecos.push(saidaInput);
            todasCoordenadas.push(todasCoordenadas[0]);
        }

        const rota = await fetchRoute(todasCoordenadas);

        const distanciaKm = (rota.distance / 1000).toFixed(2);
        const duracaoSegundos = rota.duration;
        const formatarDuracao = (seg) => {
            const horas = Math.floor(seg / 3600);
            const minutos = Math.floor((seg % 3600) / 60);
            return `${horas}h ${minutos}min`;
        };
        infoRotaDiv.innerHTML = `
            <div class="resultado-bloco"><strong>Distância Total:</strong> ${distanciaKm} km</div>
            <div class="resultado-bloco"><strong>Tempo Estimado:</strong> ${formatarDuracao(duracaoSegundos)}</div>
        `;

        const routeLine = L.geoJSON(rota.geometry, { style: { color: '#0056b3', weight: 6 } });
        routeLayer.addLayer(routeLine);

        // --- LÓGICA ATUALIZADA PARA EVITAR SOBREPOSIÇÃO DE MARCADORES ---
        todosEnderecos.forEach((endereco, index) => {
            const coords = todasCoordenadas[index];
            let popupTexto = '';
            let numeroDoPonto = index + 1;

            // Se for o último ponto de um retorno à origem, nós simplesmente pulamos a criação do marcador
            if (retornarOrigem && index === todosEnderecos.length - 1) {
                return; // Pula para a próxima iteração (não faz nada)
            }
            
            // Lógica de texto atualizada para o marcador
            if (index === 0) {
                if (retornarOrigem) {
                    popupTexto = `<b>Saída e Retorno:</b><br>${endereco}`;
                    numeroDoPonto = `1 / ${todosEnderecos.length}`; // Ex: "1 / 4"
                } else {
                    popupTexto = `<b>Saída:</b><br>${endereco}`;
                    // numeroDoPonto já é '1'
                }
            } else {
                popupTexto = `<b>Parada ${numeroDoPonto}:</b><br>${endereco}`;
                // numeroDoPonto já é '2', '3', etc.
            }

            L.marker([coords.lat, coords.lon])
                .addTo(routeLayer)
                .bindPopup(popupTexto)
                .bindTooltip(String(numeroDoPonto), {
                    permanent: true,
                    direction: 'top',
                    offset: [0, -10],
                    className: 'marker-label'
                });
        });
        
        map.fitBounds(routeLine.getBounds());

    } catch (error) {
        alert('Falha ao criar a rota: ' + error.message);
        infoRotaDiv.innerHTML = 'Não foi possível gerar a rota. Verifique os endereços.';
    }
}

// =================================================================
// 5. EVENT LISTENERS (Ponto de Entrada da Página)
// =================================================================
document.getElementById('criar-rota').addEventListener('click', criarRotaNoMapa);
document.getElementById('adicionar-parada').addEventListener('click', adicionarCampoParada);