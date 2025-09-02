// script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- ELEMENTOS DO DOM ---
    const addFeedForm = document.getElementById('add-feed-form');
    const feedUrlInput = document.getElementById('feed-url');
    const newsContainer = document.getElementById('news-container');
    const feedListContainer = document.getElementById('feed-list');
    const loadingIndicator = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    // Modal de detalhes (já existia)
    const contentModal = document.getElementById('content-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const closeModalBtn = document.getElementById('close-modal-btn');

    // Config API
    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    const apiKeyStatus = document.getElementById('api-key-status');

    // Novo: Modal Editor de Post
    const editorModal = document.getElementById('editor-modal');
    const closeEditorBtn = document.getElementById('close-editor-btn');
    const editorForm = document.getElementById('editor-form');
    const editorTitle = document.getElementById('editor-title');
    const editorKicker = document.getElementById('editor-kicker');
    const editorSummary = document.getElementById('editor-summary');
    const editorBody = document.getElementById('editor-body');
    const copyHtmlBtn = document.getElementById('copy-html-btn');
    const copyMdBtn = document.getElementById('copy-md-btn');

    // --- ESTADO DA APLICAÇÃO ---
    const CORS_PROXY = "https://corsproxy.io/?";
    const FEEDS_STORAGE_KEY = 'juridico_rss_feeds_structured';
    const API_KEY_STORAGE_KEY = 'juridico_gemini_api_key';

    // Inclui suas fontes como padrão + as que já existiam
    const initialFeeds = [
        // Já existiam
        'http://www.stf.jus.br/portal/rss/noticiaRss.asp',
        'https://www.stj.jus.br/sites/portalp/Paginas/rss/rss.aspx',
        'https://www.tst.jus.br/rss/noticia',
        // Suas novas
        'https://www.stj.jus.br/sites/portalp/Comunicacao/conte%C3%BAdos-por-feed-(rss)',
        'https://www.tjmg.jus.br/data/rss/noticiasTJMG.xml',
        'https://www.tjpi.jus.br/portaltjpi/sobre-rss/',
        'https://www.tjpr.jus.br/rss-geral-comunicacao/-/asset_publisher/uj3N/rss',
        'https://www.tjba.jus.br/portal/feed-noticias-tjba/',
        'https://www.cjf.jus.br/cjf/rss-noticias/o-que-e'
    ];

    let feeds = JSON.parse(localStorage.getItem(FEEDS_STORAGE_KEY)) || initialFeeds;
    let apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    let processedNewsCache = new Map();

    // --- UTIL ---
    const saveFeeds = () => localStorage.setItem(FEEDS_STORAGE_KEY, JSON.stringify(feeds));

    const saveApiKey = () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem(API_KEY_STORAGE_KEY, key);
            apiKey = key;
            apiKeyStatus.textContent = "Chave salva! As notícias serão recarregadas com a nova chave.";
            apiKeyStatus.classList.remove('hidden');
            setTimeout(() => apiKeyStatus.classList.add('hidden'), 4000);
            processedNewsCache.clear();
            fetchAllNews();
        }
    };

    if (apiKey) apiKeyInput.value = apiKey;

    const formatDate = (dateString) => {
        try {
            return new Date(dateString).toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return 'Data inválida'; }
    };

    // --- LISTA DE FEEDS ---
    const renderFeedList = () => {
        feedListContainer.innerHTML = '';
        if (feeds.length === 0) {
            feedListContainer.innerHTML = `<p class="text-gray-500">Nenhuma fonte adicionada.</p>`;
            return;
        }
        feeds.forEach(feedUrl => {
            const feedTag = document.createElement('div');
            feedTag.className = 'flex items-center bg-gray-700 text-gray-300 text-sm font-medium pl-3 pr-2 py-1 rounded-full';
            try {
                const hostname = new URL(feedUrl).hostname.replace('www.', '');
                feedTag.textContent = hostname;
            } catch (e) {
                feedTag.textContent = feedUrl.substring(0, 30) + '...';
            }
            const removeButton = document.createElement('button');
            removeButton.innerHTML = '&times;';
            removeButton.className = 'ml-2 text-lg text-gray-400 hover:text-white focus:outline-none';
            removeButton.onclick = () => removeFeed(feedUrl);
            feedTag.appendChild(removeButton);
            feedListContainer.appendChild(feedTag);
        });
    };

    const addFeed = (url) => {
        if (url && !feeds.includes(url)) {
            feeds.push(url);
            saveFeeds();
            renderFeedList();
            fetchAllNews();
        }
        feedUrlInput.value = '';
    };

    const removeFeed = (url) => {
        feeds = feeds.filter(feed => feed !== url);
        saveFeeds();
        renderFeedList();
        fetchAllNews();
    };

    // --- FETCH DE FEEDS (RSS/ATOM) ---
    const fetchAllNews = async () => {
        if (feeds.length === 0) {
            newsContainer.innerHTML = `<div class="col-span-full text-center p-10 bg-gray-800 rounded-lg"><p class="text-gray-400">Adicione uma fonte de notícias RSS para começar.</p></div>`;
            return;
        }
        loadingIndicator.classList.remove('hidden');
        errorMessage.classList.add('hidden');
        newsContainer.innerHTML = '';

        try {
            const feedItemsPromises = feeds.map(async (feedUrl) => {
                try {
                    const response = await fetch(`${CORS_PROXY}${encodeURIComponent(feedUrl)}`);
                    if (!response.ok) return [];
                    const text = await response.text();
                    const parser = new DOMParser();
                    // Tenta XML; se falhar, pode ser uma página de índice com links
                    const xml = parser.parseFromString(text, "application/xml");

                    // Detecta erro de parse
                    if (xml.querySelector('parsererror')) {
                        // Tenta extrair links de feed de uma página HTML (ex.: páginas "Sobre RSS")
                        const doc = parser.parseFromString(text, "text/html");
                        const links = Array.from(doc.querySelectorAll('a[href*="rss"], a[type="application/rss+xml"], a[type="application/atom+xml"]'))
                            .map(a => a.getAttribute('href'))
                            .filter(Boolean);
                        if (links.length) {
                            // Baixa o primeiro link de feed encontrado
                            const real = new URL(links[0], feedUrl).toString();
                            const r2 = await fetch(`${CORS_PROXY}${encodeURIComponent(real)}`);
                            const t2 = await r2.text();
                            const xml2 = parser.parseFromString(t2, "application/xml");
                            return extractFeedItems(xml2, real);
                        }
                        return [];
                    }

                    return extractFeedItems(xml, feedUrl);
                } catch {
                    return [];
                }
            });

            const allFeedItemsArrays = await Promise.all(feedItemsPromises);
            let allItems = allFeedItemsArrays.flat();

            if (allItems.length === 0) throw new Error("Nenhum item de notícia foi encontrado nos feeds RSS/Atom.");

            // Ordena por data
            allItems.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

            // Mostra bastante coisa recente; ajuste se quiser
            const recentItems = allItems.slice(0, 18);

            const processedNewsPromises = recentItems.map(item => processNewsItem(item));
            const processedNews = await Promise.all(processedNewsPromises);

            const validNews = processedNews.filter(item => item !== null);

            if (validNews.length === 0) throw new Error("Não foi possível processar o conteúdo de nenhuma notícia.");

            renderNews(validNews);

        } catch (error) {
            console.error("Erro geral ao buscar notícias:", error);
            errorText.textContent = error.message || "Não foi possível carregar as notícias. Verifique as URLs dos feeds ou a sua conexão.";
            errorMessage.classList.remove('hidden');
        } finally {
            loadingIndicator.classList.add('hidden');
        }
    };

    const extractText = (node) => node?.textContent?.trim() || '';

    const tryGet = (el, sel, attr) => {
        const n = el.querySelector(sel);
        if (!n) return null;
        return attr ? n.getAttribute(attr) : extractText(n);
    };

    // Suporte a RSS <item> e Atom <entry>
    const extractFeedItems = (xml, feedUrl) => {
        const channelTitle = xml.querySelector('channel > title')?.textContent?.trim();
        const feedTitle = xml.querySelector('feed > title')?.textContent?.trim();
        const source = channelTitle || feedTitle || new URL(feedUrl).hostname;

        const items = [];

        // RSS
        xml.querySelectorAll('item').forEach(item => {
            const link = extractText(item.querySelector('link')) || tryGet(item, 'guid') || '#';
            const title = extractText(item.querySelector('title')) || 'Sem título';
            const pubDate = extractText(item.querySelector('pubDate')) ||
                            extractText(item.querySelector('date')) ||
                            new Date().toISOString();
            items.push({ link, title, pubDate, source });
        });

        // ATOM
        xml.querySelectorAll('entry').forEach(entry => {
            let link = '#';
            const linkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
            if (linkEl) link = linkEl.getAttribute('href') || '#';

            const title = extractText(entry.querySelector('title')) || 'Sem título';
            const pubDate = extractText(entry.querySelector('updated')) ||
                            extractText(entry.querySelector('published')) ||
                            new Date().toISOString();
            items.push({ link, title, pubDate, source });
        });

        return items;
    };

    const processNewsItem = async (item) => {
        if (processedNewsCache.has(item.link)) {
            return processedNewsCache.get(item.link);
        }
        try {
            const analysis = await extractArticleData(item);
            const result = { ...item, analysis };
            processedNewsCache.set(item.link, result);
            return result;
        } catch (error) {
            console.error(`Falha ao processar item ${item.link}:`, error);
            return null;
        }
    };

    const scrapeArticleContent = async (url) => {
        try {
            const response = await fetch(`${CORS_PROXY}${encodeURIComponent(url)}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            doc.querySelectorAll('script, style, header, footer, nav, aside').forEach(el => el.remove());
            const textContent = doc.body.textContent || "";
            return textContent.replace(/\s\s+/g, ' ').trim().substring(0, 15000);
        } catch (error) {
            console.error("Erro ao extrair conteúdo do artigo:", error);
            return null;
        }
    };

    const extractArticleData = async (item) => {
        if (!apiKey) {
            // Sem chave: usa título e mostra instrução
            return {
                title: item.title,
                kicker: "",
                summary: "Insira uma chave de API do Google AI Studio para ver o resumo e os detalhes da notícia.",
                headings: []
            };
        }

        const articleContent = await scrapeArticleContent(item.link);
        if (!articleContent) {
            // fallback leve, sem travar tudo
            return {
                title: item.title,
                kicker: "",
                summary: "Não foi possível analisar o corpo desta notícia automaticamente.",
                headings: []
            };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
        const prompt = `Analise o seguinte texto de uma notícia e extraia as informações em formato JSON. O texto pode estar mal formatado. Ignore qualquer texto que não seja o corpo da notícia.
Texto da notícia: "${articleContent}"
Extraia as seguintes informações:
- title: O título principal da notícia.
- kicker: O "chapéu" ou linha fina, uma frase curta que vem antes do título. Se não houver, retorne "".
- summary: Um resumo conciso da notícia em um parágrafo.
- headings: Uma lista (array) dos principais subtítulos (H2) encontrados no texto.`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "title": { "type": "STRING" },
                        "kicker": { "type": "STRING" },
                        "summary": { "type": "STRING" },
                        "headings": { "type": "ARRAY", "items": { "type": "STRING" } }
                    }
                }
            }
        };

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const result = await response.json();
            if (result.candidates && result.candidates.length > 0) {
                const jsonText = result.candidates[0].content.parts[0].text;
                return JSON.parse(jsonText);
            }
            throw new Error("Resposta inválida da API.");
        } catch (error) {
            console.error("Erro ao chamar a API de análise:", error);
            return {
                title: item.title,
                kicker: "",
                summary: "Não foi possível gerar o resumo desta notícia no momento.",
                headings: []
            };
        }
    };

    // --- RENDER ---
    const renderNews = (items) => {
        newsContainer.innerHTML = '';
        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'bg-gray-800 rounded-lg shadow-lg overflow-hidden flex flex-col';
            const { title, kicker, summary } = item.analysis;

            card.innerHTML = `
                <div class="p-6 flex-grow flex flex-col">
                    <p class="text-sm text-blue-400 mb-1 font-semibold">${item.source}</p>
                    ${kicker ? `<p class="text-xs text-gray-400 mb-2 uppercase">${kicker}</p>` : ''}
                    <h3 class="text-lg font-bold text-white mb-3">
                        <a href="${item.link}" target="_blank" rel="noopener noreferrer" class="hover:underline">
                            ${title}
                        </a>
                    </h3>
                    <p class="text-sm text-gray-300 flex-grow">${summary || 'Não foi possível gerar um resumo.'}</p>
                    <p class="text-xs text-gray-500 mt-4">${formatDate(item.pubDate)}</p>
                </div>
                <div class="p-4 bg-gray-700/50 grid grid-cols-2 gap-3">
                     <button class="text-sm font-semibold py-2 px-4 bg-gray-600 hover:bg-gray-500 rounded-md transition-colors details-btn">
                        Ver detalhes
                    </button>
                     <button class="text-sm font-semibold py-2 px-4 bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors editor-btn">
                        Criar notícia
                    </button>
                </div>
            `;

            const detailsBtn = card.querySelector('.details-btn');
            if (!apiKey) {
                detailsBtn.disabled = true;
                detailsBtn.textContent = 'Insira a API Key para ver';
                detailsBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                detailsBtn.addEventListener('click', () => showDetailsModal(item));
            }

            const editorBtn = card.querySelector('.editor-btn');
            editorBtn.addEventListener('click', () => openEditorWith(item));

            newsContainer.appendChild(card);
        });
    };

    const showDetailsModal = (item) => {
        const { title, headings } = item.analysis;
        modalTitle.textContent = title;

        let headingsHtml = '<h2>Principais Tópicos</h2>';
        if (headings && headings.length > 0) {
            headingsHtml += '<ul>' + headings.map(h => `<li class="ml-4 list-disc text-gray-300 mb-2">${h}</li>`).join('') + '</ul>';
        } else {
            headingsHtml += '<p class="text-gray-400">Nenhum tópico adicional foi extraído.</p>';
        }

        modalBody.innerHTML = `<div class="prose prose-invert max-w-none">${headingsHtml}</div>`;
        contentModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    };

    const closeModal = () => {
        contentModal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    };

    // --- EDITOR DE POST ---
    const openEditorWith = (item) => {
        const { title, kicker, summary, headings } = item.analysis || {};
        editorTitle.value = title || item.title || '';
        editorKicker.value = kicker || '';
        editorSummary.value = summary || '';
        // Gera um corpo base com H2/H3 a partir das headings
        const h2s = (headings || []).map(h => `## ${h}`).join('\n\n');
        editorBody.value = `${h2s}\n\n[Leia mais na fonte](${item.link})`;
        editorModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Ao enviar (se quiser evoluir para “salvar rascunho”)
        editorForm.onsubmit = (e) => {
            e.preventDefault();
        };

        copyHtmlBtn.onclick = () => copyToClipboard(buildPostHTML());
        copyMdBtn.onclick = () => copyToClipboard(buildPostMarkdown());
    };

    const closeEditor = () => {
        editorModal.classList.add('hidden');
        document.body.style.overflow = 'auto';
    };

    const buildPostHTML = () => {
        const t = escapeHtml(editorTitle.value.trim());
        const k = escapeHtml(editorKicker.value.trim());
        const s = escapeHtml(editorSummary.value.trim());
        // Converte markdown leve do body em HTML simples (H2/H3 + parágrafos)
        const body = mdToBasicHtml(editorBody.value);
        return `
<h1>${t}</h1>
${k ? `<p class="kicker"><em>${k}</em></p>` : ''}
<h2>Resumo</h2>
<p>${s}</p>
${body}
        `.trim();
    };

    const buildPostMarkdown = () => {
        const t = editorTitle.value.trim();
        const k = editorKicker.value.trim();
        const s = editorSummary.value.trim();
        const body = editorBody.value.trim();
        return `
# ${t}
${k ? `*${k}*\n` : ''}
## Resumo
${s}

${body}
        `.trim();
    };

    const mdToBasicHtml = (md) => {
        // Conversão bem simples só para H2/H3 e parágrafos
        return md
            .split('\n')
            .map(line => {
                if (line.startsWith('### ')) return `<h3>${escapeHtml(line.replace(/^###\s*/, ''))}</h3>`;
                if (line.startsWith('## ')) return `<h2>${escapeHtml(line.replace(/^##\s*/, ''))}</h2>`;
                if (/^\s*$/.test(line)) return '';
                // links [txt](url)
                const html = escapeHtml(line).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
                return `<p>${html}</p>`;
            })
            .join('\n');
    };

    const escapeHtml = (str) => str
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            copyHtmlBtn.textContent = 'Copiado!';
            copyMdBtn.textContent = 'Copiado!';
            setTimeout(() => {
                copyHtmlBtn.textContent = 'Copiar HTML';
                copyMdBtn.textContent = 'Copiar Markdown';
            }, 1200);
        } catch (e) {
            alert('Não foi possível copiar automaticamente. Selecione e copie manualmente.');
        }
    };

    // --- LISTENERS ---
    addFeedForm.addEventListener('submit', (e) => {
        e.preventDefault();
        addFeed(feedUrlInput.value.trim());
    });

    saveApiKeyBtn.addEventListener('click', saveApiKey);

    closeModalBtn.addEventListener('click', () => closeModal());
    contentModal.addEventListener('click', (e) => { if (e.target === contentModal) closeModal(); });

    closeEditorBtn.addEventListener('click', () => closeEditor());
    editorModal.addEventListener('click', (e) => { if (e.target === editorModal) closeEditor(); });

    // Init
    renderFeedList();
    fetchAllNews();
});
