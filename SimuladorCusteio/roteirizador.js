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

// Encontre a função processarEndereco e substitua por esta

// Verifique se a sua função em roteirizador.js está igual a esta

async function processarEndereco(enderecoInput) {
    // 1. Tenta processar como CEP primeiro (mais confiável)
    const cepLimpo = enderecoInput.replace(/\D/g, ''); // Limpa o input, removendo hífens, etc.
    if (/^\d{8}$/.test(cepLimpo)) {
        try {
            // 2. Se for CEP, usa a BrasilAPI que retorna endereço E coordenadas
            const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepLimpo}`);
            if (response.ok) {
                const data = await response.json();
                // VERIFICAÇÃO DEFENSIVA
                if (data.location?.coordinates?.latitude && data.location?.coordinates?.longitude) {
                    return {
                        endereco: `${data.street}, ${data.city}`,
                        coords: {
                            lat: data.location.coordinates.latitude,
                            lon: data.location.coordinates.longitude
                        }
                    };
                }
            }
        } catch (error) {
            console.warn(`Falha na BrasilAPI para o CEP ${cepLimpo}. Tentando como endereço.`, error);
        }
    }

    // 3. Se não for um CEP ou se a primeira tentativa falhar, usa o Nominatim
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(enderecoInput)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data && data.length > 0) {
            // VERIFICAÇÃO DEFENSIVA
            const lat = data[0].lat;
            const lon = data[0].lon;
            if (lat && lon) {
                return {
                    endereco: data[0].display_name.split(',')[0],
                    coords: { lat: lat, lon: lon }
                };
            }
        }
    } catch (error) {
        console.error(`Falha ao geocodificar "${enderecoInput}" com Nominatim`, error);
    }
    
    // 4. Se NENHUM método funcionar ou retornar coordenadas válidas, retorna nulo
    console.warn(`Não foi possível obter coordenadas válidas para: "${enderecoInput}". Ponto descartado.`);
    return null;
}

async function fetchOptimalRoute(coordsArray, roundtrip) {
    const profile = 'driving';
    const coordsString = coordsArray.map(c => `${c.lon},${c.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/trip/v1/${profile}/${coordsString}?source=first&roundtrip=${roundtrip}&overview=full&geometries=geojson`;

    try {
        const response = await fetch(osrmUrl);
        const data = await response.json();
        if (data.code !== 'Ok') { throw new Error(data.message || 'Não foi possível otimizar a rota.'); }
        return data; 
    } catch (error) {
        throw error;
    }
}

// =================================================================
// 4. FUNÇÃO PRINCIPAL DO ROTEIRIZADOR (LÓGICA FINAL)
// =================================================================

async function criarRotaNoMapa() {
    routeLayer.clearLayers();
    const infoRotaDiv = document.getElementById('info-rota');
    infoRotaDiv.innerHTML = 'Processando endereços e otimizando a rota...';

    const saidaInput = document.getElementById('ponto-saida').value;
    const paradaInputs = document.querySelectorAll('.ponto-parada');

    if (!saidaInput || Array.from(paradaInputs).some(input => !input.value)) {
        alert('Por favor, preencha todos os campos de endereço.');
        infoRotaDiv.innerHTML = '';
        return;
    }

    const todosEnderecosParaProcessar = [saidaInput, ...Array.from(paradaInputs).map(input => input.value)];
    const retornarOrigem = document.getElementById('retornar-origem').checked;

    try {
        const processamentoPromises = todosEnderecosParaProcessar.map(addr => processarEndereco(addr));
        const pontosProcessados = await Promise.all(processamentoPromises);

        const pontosValidos = pontosProcessados.filter(p => p !== null);

        if (pontosValidos.length < 2) {
            throw new Error("São necessários pelo menos 2 endereços válidos para criar uma rota.");
        }
        
        const coordenadasValidas = pontosValidos.map(p => p.coords);

        const resultadoOtimizado = await fetchOptimalRoute(coordenadasValidas, retornarOrigem);
        
        const rota = resultadoOtimizado.trips[0];
        const waypointsOtimizados = resultadoOtimizado.waypoints;

        if (!rota || !waypointsOtimizados) {
            throw new Error("A API não retornou uma rota otimizada válida.");
        }

        // Usa os nomes retornados pela API para garantir consistência
        const ordemFormatada = waypointsOtimizados.map(wp => wp.name || "Ponto desconhecido").join(' &rarr; ');

        const distanciaKm = (rota.distance / 1000).toFixed(2);
        const duracaoSegundos = rota.duration;
        const formatarDuracao = (seg) => {
            const horas = Math.floor(seg / 3600);
            const minutos = Math.floor((seg % 3600) / 60);
            return `${horas}h ${minutos}min`;
        };
        infoRotaDiv.innerHTML = `
            <div class="resultado-bloco"><strong>Distância Otimizada:</strong> ${distanciaKm} km</div>
            <div class="resultado-bloco"><strong>Tempo Estimado:</strong> ${formatarDuracao(duracaoSegundos)}</div>
            <div class="resultado-bloco">
                <strong>Ordem de Atendimento:</strong><br>
                <span style="font-size: 0.9em; color: #555;">${ordemFormatada}</span>
            </div>
        `;

        const routeLine = L.geoJSON(rota.geometry, { style: { color: '#0056b3', weight: 6 } });
        routeLayer.addLayer(routeLine);
        
        // --- LÓGICA DE MARCADORES 100% BASEADA NA RESPOSTA DA API ---
        waypointsOtimizados.forEach((waypoint, index) => {
            const numeroDoPonto = index + 1;
            const popupTexto = `<b>Ponto ${numeroDoPonto}:</b><br>${waypoint.name || 'Localização aproximada'}`;

            L.marker([waypoint.location[1], waypoint.location[0]]) // [lat, lon]
                .addTo(routeLayer)
                .bindPopup(popupTexto)
                .bindTooltip(String(numeroDoPonto), {
                    permanent: true, direction: 'top', offset: [0, -10], className: 'marker-label'
                });
        });
        
        map.fitBounds(routeLayer.getBounds(), {padding: [50, 50]});

    } catch (error) {
        alert('Falha ao criar a rota: ' + error.message);
        infoRotaDiv.innerHTML = 'Não foi possível gerar a rota. Verifique os endereços.';
    }
}

// =================================================================
// 5. EVENT LISTENERS
// =================================================================

document.getElementById('criar-rota').addEventListener('click', criarRotaNoMapa);
document.getElementById('adicionar-parada').addEventListener('click', adicionarCampoParada);