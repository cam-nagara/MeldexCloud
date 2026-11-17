/* Leaflet rendering is isolated from document mutation and persistence. */
(function (root) {
  'use strict';
  const D = () => root.MeldexMapDocument;
  const SYMBOLS = { pin: '●', city: '◆', castle: '♜', mountain: '▲', forest: '♠', port: '⚓' };
  function terrainCanvas(terrain) { return root.MeldexMapTerrainRender.canvas(terrain); }
  function removeMap(map){
    if(!map)return;
    const canvases=[];map.eachLayer(layer=>{if(layer instanceof L.Canvas)canvases.push(layer);});
    map.stop();map.remove();
    // Removing a feature group can queue another Canvas redraw after its renderer
    // has already been removed. Cancel that final frame before it sees no context.
    for(const renderer of canvases){L.Util.cancelAnimFrame(renderer._redrawRequest);renderer._redrawRequest=null;}
  }
  let vectorRenderer;
  function nativeRenderer(){
    if(!vectorRenderer)vectorRenderer=L.SVG.extend({_updatePoly(layer,closed){
      const g=layer.options.meldexGeometry,f=layer.options.meldexFeature;
      if(!g)return L.SVG.prototype._updatePoly.call(this,layer,closed);
      const origin=this._map.latLngToLayerPoint([0,0]),z=this._map.options.crs.scale(this._map.getZoom());
      layer._path.setAttribute('d',g.path);
      layer._path.setAttribute('transform',`matrix(${z*g.scale[0]} 0 0 ${z*g.scale[1]} ${origin.x+z*(f.points[0][0]-g.anchor[0])} ${origin.y+z*(f.points[0][1]-g.anchor[1])})`);
      layer._path.setAttribute('vector-effect','non-scaling-stroke');
      layer._path.dataset.mapFeatureId=f.id;
    }});
    return vectorRenderer;
  }
  class MapView {
    constructor(container, callbacks) {
      this.container = container; this.callbacks = callbacks; this.tool = 'select'; this.draft = []; this.symbol = 'pin';
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      this.rotation = 0; this.selectedIds = new Set(); this.items = new Map();
      this.interaction = new root.MeldexMapInteraction.Controller(this);
      this._pointer = event => this._paintPointer(event);
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => container.addEventListener(type, this._pointer, true));
      this._observer = new ResizeObserver(() => this._resize());
      this._observer.observe(container);
    }
    xy(latlng) {
      if (this.doc.coordinate_system === 'local') return [latlng.lng, -latlng.lat];
      return [((latlng.lng + 180) % 360 + 360) % 360 - 180, Math.max(-85.051129, Math.min(85.051129, latlng.lat))];
    }
    latlng(point) { return this.doc.coordinate_system === 'local' ? [-point[1], point[0]] : [point[1], point[0]]; }
    selection() { return this.selectedIds; }
    choose(ids, active = null) {
      this.selectedIds = new Set(ids); this.selectedId = active && this.selectedIds.has(active) ? active : ids.at(-1) || null;
      if (this.callbacks.selection) this.callbacks.selection([...this.selectedIds], this.selectedId); else this.callbacks.select?.(this.selectedId);
      this._features();
    }
    screenPoint(point) {
      const p = this.map.latLngToContainerPoint(this.latlng(point)), size = this.map.getSize();
      const q = root.MeldexMapInteraction.rotate([p.x - size.x / 2, p.y - size.y / 2], this.rotation);
      return [q[0] + this.container.clientWidth / 2, q[1] + this.container.clientHeight / 2];
    }
    setRotation(value, notify = true) {
      const next = root.MeldexMapInteraction.angle(value); if (next === this.rotation) return;
      this.rotation = next; this._resize(); this._indicators(); if (notify) this.callbacks.rotation?.(next);
    }
    _resize() {
      if (!this.map || !this.host) return;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      const size = this.rotation ? Math.ceil(Math.hypot(w, h)) : null;
      Object.assign(this.host.style, { width: (size || w) + 'px', height: (size || h) + 'px', transform: `translate(-50%,-50%) rotate(${this.rotation}deg)` });
      this.map.invalidateSize({ pan: true, animate: false }); this._indicators();
    }
    zoomAt(zoom, screen = null, anchor = null) {
      zoom = Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), zoom));
      const p = screen || [this.container.clientWidth / 2, this.container.clientHeight / 2], native = this.interaction.native(p);
      if (!anchor) this.map.setZoomAround(native, zoom, { animate: false });
      else {
        const size = this.map.getSize(), offset = native.subtract(size.divideBy(2));
        this.map.setView(this.map.unproject(this.map.project(anchor, zoom).subtract(offset), zoom), zoom, { animate: false });
      }
    }
    stepZoom(direction, screen = null) {
      const z = this.map.getZoom();
      const next = this.doc.coordinate_system === 'local' ? Math.log2(Math.max(.1, (Math.round(2 ** z * 10) + direction) / 10)) : z + direction * Math.log2(1.1);
      this.zoomAt(next, screen);
    }
    zoom100() { this.zoomAt(this.doc.coordinate_system === 'world' ? 13 : 0); }
    resetView() { this.setRotation(0); this.map.setView(this.doc.coordinate_system === 'local' ? [-this.doc.canvas.height / 2, this.doc.canvas.width / 2] : this.map.getCenter(), this.doc.coordinate_system === 'local' ? 0 : 13, { animate: false }); }
    panScreen(delta) { const d = root.MeldexMapInteraction.rotate(delta, -this.rotation); this.map.panBy([-d[0], -d[1]], { animate: false }); }
    focusSelection() {
      const features = this.doc.features.filter(f => this.selectedIds.has(f.id));
      if (features.length === 1) this.focus(features[0]);
      else if (features.length) this._fitPoints(features.flatMap(f => f.points), this.map.getZoom());
    }
    setDocument(doc, readOnly = false) {
      const rebuild = !this.map || this.doc?.coordinate_system !== doc.coordinate_system;
      if (this.doc?.features !== doc.features || readOnly || doc.atlas?.locked) { this.interaction.cancel(); if(this._atlasPainting)this.cancel(); }
      this.doc = doc; this.readOnly = readOnly;
      this.container.classList.toggle('gb-map-native-atlas',!!doc.atlas);
      if (rebuild) this._create();
      const basemap = doc.basemap + ':' + (doc.basemap_style || 'pale');
      if (this._basemap !== basemap) {
        this.tiles?.remove(); this.tiles = null; this._basemap = basemap;
        if (doc.coordinate_system === 'world') this.map.setMinZoom(doc.basemap === 'gsi' ? 2 : 1);
        if (doc.coordinate_system === 'world' && doc.basemap !== 'blank') {
          const gsi = doc.basemap === 'gsi';
          this.tiles = L.tileLayer(gsi ? 'https://cyberjapandata.gsi.go.jp/xyz/' + (doc.basemap_style === 'standard' ? 'std' : 'pale') + '/{z}/{x}/{y}.png' : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, maxNativeZoom: gsi ? 18 : 19, minZoom: gsi ? 2 : 1,
            attribution: gsi ? '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a> · 海岸線: NIMA/USGS VMAP0 (1997)' + (doc.basemap_style === 'standard' ? ' · 海底地形: GEBCO Digital Atlas (BODC・IOC/IHO, 2003, <a href="https://www.gebco.net" target="_blank" rel="noopener">GEBCO</a>) · 海上保安庁許可第292502号（水路業務法第25条に基づく類似刊行物）' : '')
              : '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
          }).addTo(this.map);
          this.tiles.on('tileerror', () => {
            if (!this._tileErrorShown) { this._tileErrorShown = true; this.callbacks.message?.('背景地図を取得できません。保存済みの地点や図形は保持されています。'); }
          });
        }
      }
      this._terrain(); this._features(); this._indicators();
      if (rebuild) {
        if (doc.view) this.map.setView(this.latlng(doc.view.center), doc.view.zoom);
        else this.fit();
      }
    }
    _create() {
      this.interaction.reset(); removeMap(this.map); this.container.replaceChildren(); this._basemap = null; this._terrainData = null; this._backgroundData = null; this._atlasData=null; this._nativeRenderer=null;this.atlasTiles=null;this._atlasTileKey=null;
      this.container.classList.add('leaflet-container');
      this.host = document.createElement('div'); this.host.className = 'gb-map-viewport'; this.container.appendChild(this.host);
      Object.assign(this.host.style, { width: this.container.clientWidth + 'px', height: this.container.clientHeight + 'px' });
      this.overlay = null; this.background = null; this.paper = null; this.tiles = null; this._tileErrorShown = false;
      const local = this.doc.coordinate_system === 'local';
      this.map = L.map(this.host, { crs: local ? L.CRS.Simple : L.CRS.EPSG3857, minZoom: local ? -5 : 1,
        maxZoom: local ? Math.log2(5) : 19, zoomControl: false, attributionControl: true, worldCopyJump: !local,
        dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
        preferCanvas: false, zoomSnap: 0, zoomAnimation: false, markerZoomAnimation: false });
      this.map.mouseEventToContainerPoint = event => this.interaction.native(this.interaction.local(event));
      this.container.appendChild(this.map._controlContainer);
      this.map.setView(local ? [-this.doc.canvas.height / 2, this.doc.canvas.width / 2] : [35.68, 139.76], local ? -2 : 5);
      const backgroundPane = this.map.createPane('map-background');
      backgroundPane.style.zIndex = '250'; backgroundPane.style.pointerEvents = 'none';
      const paperPane = this.map.createPane('map-paper');
      paperPane.style.zIndex = '200'; paperPane.style.pointerEvents = 'none';
      const zoom = L.control({ position: 'topleft' }); zoom.onAdd = () => {
        const el = L.DomUtil.create('div', 'leaflet-bar gb-map-zoom-control');
        for (const [symbol, label, step] of [['+', '拡大', 1], ['−', '縮小', -1]]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = symbol; b.setAttribute('aria-label', label); b.onclick = () => this.stepZoom(step); el.appendChild(b); }
        L.DomEvent.disableClickPropagation(el); return el;
      }; zoom.addTo(this.map);
      this.features = L.featureGroup().addTo(this.map); this.drafts = L.featureGroup().addTo(this.map);
      this.sheetFeatures = L.featureGroup().addTo(this.map);
      const compass = L.control({ position: 'topright' });
      compass.onAdd = () => {
        const el = L.DomUtil.create('div', 'gb-map-compass');
        el.setAttribute('aria-label', '北方向');
        this.compass = document.createElement('div'); this.compass.className = 'gb-map-compass-arrow'; this.compass.textContent = 'N\n▲';
        el.appendChild(this.compass); L.DomEvent.disableClickPropagation(el); return el;
      }; compass.addTo(this.map);
      const scale = L.control({ position: 'bottomleft' });
      scale.onAdd = () => {
        const el = L.DomUtil.create('div', 'gb-map-scale'); el.setAttribute('aria-label', '縮尺');
        this.scaleLabel = document.createElement('span'); this.scaleLine = document.createElement('div'); this.scaleNote = document.createElement('small');
        el.append(this.scaleLabel, this.scaleLine, this.scaleNote); L.DomEvent.disableClickPropagation(el); return el;
      }; scale.addTo(this.map);
      this.map.on('moveend zoomend', () => {
        if (!this.map || this._destroyed) return;
        this._indicators();
        this._layoutLabels();
        this.callbacks.view?.({ center: this.xy(this.map.getCenter()), zoom: this.map.getZoom() });
        this.callbacks.zoom?.(this.map.getZoom());
      });
      this.map.on('mousemove', event => this.callbacks.position?.(this.xy(event.latlng)));
      this.setTool(this.tool);
      this._resize();
    }
    fit() {
      if (!this.map) return;
      const local = this.doc.coordinate_system === 'local';
      if (!local && !this.doc.features.length) { this.map.setView([35.68, 139.76], this.doc.basemap === 'gsi' ? 7 : 5); return; }
      const points = local ? [[0, 0], [this.doc.canvas.width, this.doc.canvas.height]] : this.doc.features.flatMap(f => f.points);
      this._fitPoints(points, local ? Math.log2(1.5) : 14);
    }
    _fitPoints(points, maxZoom) {
      let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
      for (const point of points) { const p = this.map.project(this.latlng(point), 0); x1 = Math.min(x1, p.x); x2 = Math.max(x2, p.x); y1 = Math.min(y1, p.y); y2 = Math.max(y2, p.y); }
      const a = this.rotation * Math.PI / 180;
      const width = Math.abs(Math.cos(a)) * (x2 - x1) + Math.abs(Math.sin(a)) * (y2 - y1);
      const height = Math.abs(Math.sin(a)) * (x2 - x1) + Math.abs(Math.cos(a)) * (y2 - y1);
      const factor = Math.min(Math.max(1, this.container.clientWidth - 60) / Math.max(width, 1e-9), Math.max(1, this.container.clientHeight - 60) / Math.max(height, 1e-9));
      const zoom = Math.max(this.map.getMinZoom(), Math.min(this.map.getMaxZoom(), maxZoom, Math.log2(factor)));
      this.map.setView(this.map.unproject(L.point((x1 + x2) / 2, (y1 + y2) / 2), 0), zoom, { animate: false });
    }
    focus(feature) {
      if (!D().visibleInPeriod(feature, this.periodId)) {
        this.periodId = (this.doc.periods || []).find(period => feature.period_ids?.includes(period.id))?.id || '';
        this.callbacks.period?.(this.periodId);
      }
      if (!this._visible(feature)) this.callbacks.reveal?.(feature);
      if (feature.points.length === 1) this.map.panTo(this.latlng(feature.points[0]), { animate: false });
      else this._fitPoints(feature.points, this.doc.coordinate_system === 'local' ? 2 : 14);
      if (!this.selectedIds.has(feature.id)) this.select(feature.id);
      else { this.selectedId = feature.id; this._features(); }
    }
    select(id) { this.selectedId = id; this.selectedIds = new Set(id ? [id] : []); this._features(); }
    setTool(tool, symbol = 'pin') {
      this.cancel(); this.tool = tool; this.symbol = symbol;
      if (!this.map) return;
      this.container.dataset.tool = tool;
      this.map.dragging.disable(); this.map.doubleClickZoom.disable();
    }
    _terrain(override) {
      const doc = this.doc;
      if (doc.coordinate_system !== 'local') return;
      const bounds = [[-doc.canvas.height, 0], [0, doc.canvas.width]];
      if (!this.paper) this.paper = L.rectangle(bounds, { pane: 'map-paper', interactive: false, stroke: false, fillColor: '#ecede2', fillOpacity: 1 }).addTo(this.map);
      else this.paper.setBounds(bounds);
      if(doc.atlas?.surface&&!override){
        const display=root.MeldexMapDisplay.effective({...doc.display,...this.elementVisibility}),baseDisplay={terrain:display.terrain,vegetation:display.vegetation,countries:display.countries};
        const key=root.MeldexMapTerrainField.scene(doc.atlas).key+'|'+doc.atlas.presentation+'|'+JSON.stringify(baseDisplay)+'|'+doc.atlas.shores.join('')+'|'+JSON.stringify(doc.atlas.modes[doc.atlas.presentation])+'|'+doc.canvas.width+':'+doc.canvas.height;
        if(this._atlasTileKey===key&&this.atlasTiles)return;
        this.background?.remove();this.background=null;this._backgroundData=null;this.overlay?.remove();this.overlay=null;this.atlasTiles?.remove();
        const atlas=doc.atlas,view=this,tileSize=256,pixelRatio=Math.min(2,root.devicePixelRatio||1),cw=doc.canvas.width,ch=doc.canvas.height;
        const Tiles=L.GridLayer.extend({createTile(coords,done){const tile=document.createElement('img');tile.alt='';tile.setAttribute('role','presentation');const layer=this;
          setTimeout(()=>{if(!layer._map)return;try{const size=tileSize/(2**coords.z),box=[coords.x*size/cw*atlas.width,coords.y*size/ch*atlas.height,size/cw*atlas.width,size/ch*atlas.height];tile.onload=()=>done(null,tile);tile.onerror=()=>done(new Error('地形タイルを表示できません'),tile);tile.src=root.MeldexMapAzgaar.url(atlas,{bounds:box,resolution:tileSize*pixelRatio,display:baseDisplay});}catch(error){done(error,tile);view.callbacks.message?.(error.message);}},0);return tile;}});
        this.atlasTiles=new Tiles({tileSize,minZoom:-5,maxZoom:3,pane:'map-background',zIndex:1,bounds:L.latLngBounds(bounds),noWrap:true,keepBuffer:1,updateWhenIdle:true}).addTo(this.map);this._atlasTileKey=key;return;
      }
      this.atlasTiles?.remove();this.atlasTiles=null;this._atlasTileKey=null;
      const atlas=doc.atlas,atlasKey=atlas?atlas.presentation:'';
      const background=atlas&&root.MeldexMapAzgaar ? (this._atlasData===atlas&&this._atlasMode===atlasKey?this._backgroundData:root.MeldexMapAzgaar.url(atlas)) : doc.background?.data_url;
      this._atlasData=atlas;this._atlasMode=atlasKey;
      if (background !== this._backgroundData) {
        this.background?.remove(); this._backgroundData = background;
        this.background = this._backgroundData ? L.imageOverlay(this._backgroundData, bounds, { interactive: false, pane: 'map-background', zIndex: 1 }).addTo(this.map) : null;
      }
      if (!override && doc.terrain === this._terrainData) return;
      this._terrainData = doc.terrain;
      const terrain = override || doc.terrain;
      this.overlay?.remove(); this.overlay = null;
      if (terrain) this.overlay = L.imageOverlay(terrainCanvas(terrain).toDataURL('image/png'), bounds, { interactive: false, pane: 'map-background', zIndex: 2, opacity: doc.background ? 0.7 : 1 }).addTo(this.map);
      this.background?.bringToBack();
    }
    _visible(feature) {
      const layer = this.doc.layers.find(l => l.id === feature.layer_id);
      return !!layer && root.MeldexMapDisplay.visible(feature,root.MeldexMapDisplay.effective({...this.doc.display,...this.elementVisibility})) && (this.layerVisibility?.[layer.id] ?? layer.visible) && D().visibleInPeriod(feature, this.periodId)
        && (!this.featureKind || feature.kind === this.featureKind)
        && (!this.filter || (feature.label + ' ' + feature.tags.join(' ') + ' ' + feature.description).toLocaleLowerCase().includes(this.filter));
    }
    _features() {
      if (!this.features) return;
      this.features.clearLayers();
      this.items.clear();
      for (const layer of [...this.doc.layers].reverse()) for (const feature of this.doc.features.filter(f => f.layer_id === layer.id && this._visible(f))) {
        const selected = this.selectedIds.has(feature.id) || feature.id === this.selectedId, editable = !this.readOnly && !layer.locked && this.tool === 'select';
        const points = D().drawPoints(feature, this.doc).map(p => this.latlng(p)), cart = root.MeldexMapTerrainRender.style(feature), marker = root.MeldexMapTerrainRender.marker(feature); let item;
        if (['pin', 'label'].includes(feature.kind)) {
          const el = document.createElement('span'); el.className = 'gb-map-pin' + (selected ? ' selected' : '') + (feature.kind === 'label' ? ' text-only' : '');
          el.style.color = feature.color; el.dataset.mapFeatureId = feature.id; el.dataset.mapRole = cart.role;
          el.dataset.mapRank = feature.cartography?.rank === 'minor' ? 'minor' : 'major';
          if (cart.role) el.style.fontSize = cart.fontSize + 'px';
          if (!marker && cart.role === 'city' && feature.points[0][0] > this.doc.canvas.width * .82) { el.style.flexDirection = 'row-reverse'; el.style.transform = `translateX(calc(-100% + ${cart.symbolSize}px))`; }
          if (cart.role && feature.kind === 'label') el.style.transform = this.doc.atlas?'translate(-50%,-50%)':'translateX(-50%)';
          if (feature.kind !== 'label') {
            const icon = document.createElement('b'),glyph=root.MeldexMapTerrainRender.symbol(feature,SYMBOLS[feature.icon]||SYMBOLS.pin);
            if(marker){
              el.classList.add('gb-map-drop-marker');const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path'),hole=document.createElementNS(ns,'circle');
              svg.setAttribute('viewBox','0 0 '+marker.width+' '+marker.height);svg.setAttribute('width',marker.width);svg.setAttribute('height',marker.height);svg.setAttribute('aria-hidden','true');
              path.setAttribute('d',marker.path);path.setAttribute('fill',feature.color);path.setAttribute('stroke','white');path.setAttribute('stroke-width','1.5');path.classList.add('gb-map-drop-shape');
              hole.setAttribute('cx',marker.centerX);hole.setAttribute('cy',marker.centerY);hole.setAttribute('r',marker.radius);hole.setAttribute('fill','white');svg.append(path,hole);
              if(['city','castle','mountain','forest','port'].includes(feature.icon)){const text=document.createElementNS(ns,'text');text.setAttribute('x',marker.centerX);text.setAttribute('y',marker.centerY);text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','central');text.setAttribute('fill',feature.color);text.setAttribute('font-size','12');text.setAttribute('font-family','sans-serif');text.setAttribute('font-weight','bold');text.textContent=glyph;svg.append(text);}
              icon.append(svg);
            }else{icon.textContent=glyph;if(cart.role==='city'){icon.style.fontSize=cart.symbolSize+'px';icon.style.lineHeight='16px';}}
            el.appendChild(icon);
          }
          const text = document.createElement('span'); text.textContent = feature.label;text.hidden=!root.MeldexMapDisplay.labels(feature,root.MeldexMapDisplay.effective({...this.doc.display,...this.elementVisibility}));el.appendChild(text);const symbol=el.querySelector('b');if(symbol)symbol.hidden=!root.MeldexMapDisplay.symbols(feature,root.MeldexMapDisplay.effective({...this.doc.display,...this.elementVisibility}));if(symbol?.hidden)text.style.pointerEvents='auto';
          item = L.marker(points[0], { icon: L.divIcon({ html: el, className: 'gb-map-marker', iconSize: marker ? [marker.width,marker.height] : cart.role === 'city' ? [16,16] : [24, 28], iconAnchor: marker ? [marker.anchorX,marker.anchorY] : cart.role === 'city' ? [cart.symbolSize/2,8] : cart.role && feature.kind === 'label' ? [0,12] : [12, 14] }),
            draggable: false, opacity: layer.opacity, zIndexOffset: selected ? 1000 : 0, title: feature.label, alt: feature.label || '地点' });
          if(this.doc.atlas&&cart.role&&feature.kind==='label')item.options.icon.options.iconAnchor=[0,0];
        } else {
          const geometry=this.doc.coordinate_system==='local'?root.MeldexMapAzgaar?.geometry(feature):null;
          const options = { color: feature.color, weight: selected ? Math.max(4,cart.weight) : cart.weight, opacity: layer.opacity,
            fillOpacity: feature.kind === 'region' ? cart.fillOpacity * layer.opacity : 0, dashArray: cart.dash || (feature.kind === 'route' && feature.dashed ? '8 5' : null) };
          if(geometry){this._nativeRenderer||=new (nativeRenderer())({padding:.5});Object.assign(options,{renderer:this._nativeRenderer,meldexGeometry:geometry,meldexFeature:feature,fill:geometry.closed,fillOpacity:geometry.closed?(cart.role==='border'?0:cart.role==='river'?1:cart.fillOpacity)*layer.opacity:0});if(cart.role==='river')options.weight=selected?3:.2;}
          item = feature.kind === 'region' ? L.polygon(points, options) : L.polyline(points, options);
          if (feature.label) { const tip = document.createElement('span'); tip.textContent = feature.label; item.bindTooltip(tip); }
        }
        this.items.set(feature.id, item);
        item.addTo(this.features);
        item.on('keypress', event => {
          if (event.originalEvent?.key === 'Enter') { this.choose([feature.id], feature.id); this.container.focus({ preventScroll: true }); }
        });
        if (feature.kind === 'route' && feature.arrow && points.length >= 2) {
          const a = this.map.latLngToLayerPoint(points[points.length - 2]), b = this.map.latLngToLayerPoint(points[points.length - 1]);
          const el = document.createElement('span'); el.className = 'gb-map-route-arrow'; el.textContent = '▶'; el.style.color = feature.color;
          el.style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI}deg)`;
          item._mapArrow = L.marker(points[points.length - 1], { interactive: false, opacity: layer.opacity,
            icon: L.divIcon({ html: el, className: 'gb-map-marker', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(this.features);
        }
        if (selected && editable && this.editVertices && ['route', 'region'].includes(feature.kind)) {
          item._mapHandles = [];
          feature.points.forEach((point, index) => {
            const el = document.createElement('span'); el.className = 'gb-map-vertex'; el.dataset.mapVertex = index; el.dataset.mapFeatureId = feature.id;
            item._mapHandles.push(L.marker(this.latlng(point), { draggable: false, icon: L.divIcon({ html: el, className: 'gb-map-marker', iconSize: [12, 12], iconAnchor: [6, 6] }) }).addTo(this.features));
          });
        }
      }
      this._layoutLabels();
    }
    _layoutLabels(){
      if(!this.doc?.atlas||!this.map)return;
      this._labelMeasure||=document.createElement('canvas').getContext('2d');
      const measure=(text,cart)=>{this._labelMeasure.font=`${cart.fontWeight||400} ${cart.fontSize}px sans-serif`;return this._labelMeasure.measureText(text).width;};
      const features=this.doc.features.filter(f=>this.items.has(f.id)&&root.MeldexMapDisplay.labels(f,root.MeldexMapDisplay.effective({...this.doc.display,...this.elementVisibility}))&&this.doc.layers.some(l=>l.id===f.layer_id&&l.opacity>0)),size=this.map.getSize();
      this._labelPlan=root.MeldexMapTerrainRender.labelLayout(features,p=>{const q=this.map.latLngToContainerPoint(this.latlng(p));return [q.x,q.y];},measure,{selected:this.selectedIds,bounds:[4,4,size.x-4,size.y-4]});
      for(const f of features){const role=f.cartography?.role;if(!role||!['pin','label'].includes(f.kind))continue;
        const el=this.items.get(f.id)?.getElement()?.querySelector('.gb-map-pin'),text=el?.querySelector(':scope>span'),plan=this._labelPlan.get(f.id),cart=root.MeldexMapTerrainRender.style(f);if(!el||!text)continue;
        text.hidden=!plan?.visible;text.style.fontWeight=String(cart.fontWeight||400);
        if(f.kind==='label'){el.hidden=!plan?.visible;if(plan?.visible)el.style.transform=`translate(calc(-50% + ${plan.dx+(plan.rect[2]-plan.rect[0]-6)/2}px),calc(-50% + ${plan.dy}px))`;}
        else if(plan?.visible){el.style.position='relative';el.style.flexDirection='row';el.style.transform='';const symbol=el.querySelector('b'),marker=root.MeldexMapTerrainRender.marker(f);symbol.style.width=(marker?.width||cart.symbolSize)+'px';symbol.style.textAlign='center';
          Object.assign(text.style,{position:'absolute',left:(marker?.anchorX??cart.symbolSize/2)+plan.dx+'px',top:(marker?.anchorY??8)+plan.dy+'px',marginTop:marker?'0':'',transform:'translateY(-50%)',overflow:'visible'});
        }
      }
    }
    hit(event, excluded = new Set()) {
      // Pointer capture retargets a stroke to the surface. Pins have no Canvas
      // path hit-test, so inspect the element at the actual pointer position.
      const target = this.container.hasPointerCapture(event.pointerId)
        ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
      const id = target && this.container.contains(target) ? target.closest?.('[data-map-feature-id]')?.dataset.mapFeatureId : null;
      if (id && !excluded.has(id)) return this.doc.features.find(f => f.id === id && this._visible(f));
      const point = this.map.mouseEventToLayerPoint(event);
      for (const [key, item] of [...this.items].reverse()) {
        if (excluded.has(key) || !item._containsPoint?.(point)) continue;
        return this.doc.features.find(f => f.id === key);
      }
      return null;
    }
    preview(id, points) {
      const item = this.items.get(id), feature = this.doc.features.find(f => f.id === id); if (!item || !feature) return;
      if(this._nativeRenderer&&item.options.renderer===this._nativeRenderer){const f={...feature,points},g=root.MeldexMapAzgaar.geometry(f);item.options.meldexFeature=f;item.options.meldexGeometry=g;const cart=root.MeldexMapTerrainRender.style(f),layer=this.doc.layers.find(l=>l.id===f.layer_id);item.setStyle({fill:!!g?.closed||f.kind==='region',fillOpacity:g?.closed?(cart.role==='border'?0:cart.role==='river'?1:cart.fillOpacity)*(layer?.opacity??1):f.kind==='region'?cart.fillOpacity*(layer?.opacity??1):0});if(!g){item._path?.removeAttribute('transform');item._path?.removeAttribute('vector-effect');}}
      const latlngs = D().drawPoints({ ...feature, points }, this.doc).map(p => this.latlng(p));
      if (feature.kind === 'pin' || feature.kind === 'label') item.setLatLng(latlngs[0]); else item.setLatLngs(latlngs);
      item._mapHandles?.forEach((marker, i) => marker.setLatLng(this.latlng(points[i])));
      if (item._mapArrow && latlngs.length > 1) {
        const a = this.map.latLngToLayerPoint(latlngs.at(-2)), b = this.map.latLngToLayerPoint(latlngs.at(-1));
        item._mapArrow.setLatLng(latlngs.at(-1));
        item._mapArrow.getElement().firstElementChild.style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI}deg)`;
      }
    }
    previewHidden(ids) { for (const id of ids) { const item = this.items.get(id); if (item?.setOpacity) item.setOpacity(.15); else item?.setStyle({ opacity: .15, fillOpacity: .03 }); } }
    inRectangle(a, b) {
      const left = Math.min(a[0], b[0]), right = Math.max(a[0], b[0]), top = Math.min(a[1], b[1]), bottom = Math.max(a[1], b[1]);
      const inside = p => p[0] >= left && p[0] <= right && p[1] >= top && p[1] <= bottom;
      const segment = (p, q) => {
        let low = 0, high = 1;
        for (const [s, d, min, max] of [[p[0], q[0] - p[0], left, right], [p[1], q[1] - p[1], top, bottom]]) {
          if (!d) { if (s < min || s > max) return false; continue; }
          const x = (min - s) / d, y = (max - s) / d; low = Math.max(low, Math.min(x, y)); high = Math.min(high, Math.max(x, y)); if (low > high) return false;
        }
        return true;
      };
      return this.doc.features.filter(f => {
        if (!this._visible(f)) return false;
        const p = D().drawPoints(f, this.doc).map(pt => this.screenPoint(pt));
        let contains = false;
        if (f.kind === 'region') for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
          if ((p[i][1] > top) !== (p[j][1] > top) && left < (p[j][0] - p[i][0]) * (top - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) contains = !contains;
        }
        return p.some(inside) || p.some((pt, i) => i && segment(p[i - 1], pt))
          || f.kind === 'region' && (contains || segment(p.at(-1), p[0]));
      }).map(f => f.id);
    }
    setSheetPlaces(places) {
      if (!this.map || !this.sheetFeatures) return;
      this.sheetFeatures.clearLayers();
      for (const place of places.slice(0, 10000)) {
        const el = document.createElement('span'); el.className = 'gb-map-pin';
        const icon = document.createElement('b'); icon.textContent = '◇'; icon.style.color = 'var(--ui-accent)';
        const label = document.createElement('span'); label.textContent = place.label; el.append(icon, label);
        const marker = L.marker(this.latlng(place.point), { keyboard: true, title: place.label,
          icon: L.divIcon({ html: el, className: 'gb-map-marker gb-map-sheet-place', iconSize: [24, 28], iconAnchor: [12, 26] }) }).addTo(this.sheetFeatures);
        marker.on('click', event => { L.DomEvent.stopPropagation(event); this.callbacks.sheetPlace?.(place); });
      }
    }
    _click(event) {
      const point = this.xy(event.latlng);
      if (this.tool === 'select') { this.callbacks.select(null); return; }
      if (this.readOnly && this.tool !== 'measure' || ['land', 'sea'].includes(this.tool)) return;
      if (['pin', 'label', 'symbol'].includes(this.tool)) this.callbacks.action({ type: 'add', kind: this.tool === 'label' ? 'label' : 'pin', points: [point], icon: this.symbol });
      else { if (!this.draft.length || Math.hypot(...this.screenPoint(point).map((n, i) => n - this.screenPoint(this.draft.at(-1))[i])) > .5) this.draft.push(point); this._draft(); }
    }
    _draft() {
      this.drafts?.clearLayers();
      if (!this.draft.length) { this.callbacks.draft?.(0, ''); return; }
      const points = this.draft.map(p => this.latlng(p));
      L.polyline(points, { color: 'var(--ui-accent)', dashArray: '5 5', weight: 3 }).addTo(this.drafts);
      for (const point of points) L.circleMarker(point, { radius: 4, color: 'var(--ui-accent)' }).addTo(this.drafts);
      this.callbacks.draft?.(this.draft.length, D().distanceLabel(D().distance(this.draft, this.doc), this.doc));
    }
    finish() {
      const minimum = this.tool === 'region' ? 3 : 2;
      if (this.draft.length < minimum) { this.callbacks.message?.(`${minimum}点以上を指定してください`); return false; }
      if (this.tool === 'measure') this.callbacks.message?.('距離: ' + D().distanceLabel(D().distance(this.draft, this.doc), this.doc));
      else this.callbacks.action({ type: 'add', kind: this.tool, points: D().clone(this.draft) });
      this.cancel(); return true;
    }
    cancel() {
      this.draft = []; this.drafts?.clearLayers(); this.callbacks.draft?.(0, '');
      if(this._atlasPainting){const id=this._atlasPainting.pointerId;this._atlasPainting=null;if(this.container.hasPointerCapture(id))this.container.releasePointerCapture(id);}
      if (this._painting) { this._painting = null; this._terrainData = null; this._terrain(); if (this.container.hasPointerCapture(this._paintingId)) this.container.releasePointerCapture(this._paintingId); }
    }
    _indicators() {
      if (!this.map || !this.scaleLabel || !this.container.clientWidth) return;
      this.container.classList.toggle('gb-map-atlas-small', this.doc?.coordinate_system === 'local' && this.map.getZoom() < -.4);
      const center = [this.container.clientWidth / 2, this.container.clientHeight / 2];
      const points = [-50, 50].map(x => this.xy(this.map.containerPointToLatLng(this.interaction.native([center[0] + x, center[1]]))));
      const bar = D().scaleBar(D().distance(points, this.doc));
      this.scaleLabel.textContent = D().distanceLabel(bar.distance, this.doc); this.scaleLine.style.width = bar.pixels + 'px';
      this.scaleNote.textContent = this.doc.coordinate_system === 'local' && !this.doc.scale.distance_per_unit ? '縮尺未設定' : '';
      this.compass.style.transform = `rotate(${(this.doc.coordinate_system === 'world' ? 0 : this.doc.scale.north_degrees) + this.rotation}deg)`;
      this.compass.parentElement.title = this.doc.coordinate_system === 'world' ? `北方向（表示の回転: ${Math.round(this.rotation)}°）` : `北方向: ${this.doc.scale.north_degrees}°（表示の回転: ${Math.round(this.rotation)}°）`;
    }
    _paintPointer(event) {
      if (!this.map || !['land', 'sea'].includes(this.tool) || this.readOnly || this.doc.atlas?.locked || event.target.closest('.leaflet-control') || this.interaction.navigationEvent(event)) return;
      if(this.doc.atlas?.surface){
        if(event.type==='pointerdown'){if(event.button!==0)return;this._atlasPainting={pointerId:event.pointerId,source:this.doc.features,points:[]};this.container.setPointerCapture(event.pointerId);}
        const stroke=this._atlasPainting;if(!stroke||stroke.pointerId!==event.pointerId)return;event.preventDefault();event.stopImmediatePropagation();
        if(['pointercancel','lostpointercapture'].includes(event.type)){this.cancel();return;}
        if(event.type==='pointerup'){this._atlasPainting=null;if(this.container.hasPointerCapture(event.pointerId))this.container.releasePointerCapture(event.pointerId);this.drafts.clearLayers();if(stroke.points.length)this.callbacks.action({type:'atlas-stroke',source:stroke.source,points:stroke.points,kind:this.tool==='sea'?'water':this.terrainKind||'plain',radius:this.brushSize||70,strength:this.terrainStrength||.7});return;}
        const p=this.xy(this.map.mouseEventToLatLng(event));if(p[0]<0||p[1]<0||p[0]>this.doc.canvas.width||p[1]>this.doc.canvas.height)return;
        const previous=stroke.points.at(-1);if(!previous||Math.hypot(...this.screenPoint(p).map((n,i)=>n-this.screenPoint(previous)[i]))>=3){if(stroke.points.length>=2048)return;stroke.points.push(p);this.drafts.clearLayers();L.polyline(stroke.points.map(q=>this.latlng(q)),{color:'#668eae',opacity:.35,weight:(this.brushSize||70)*2*2**this.map.getZoom(),lineCap:'round',interactive:false}).addTo(this.drafts);}return;
      }
      if (event.type === 'pointerdown') {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopImmediatePropagation();
        this._painting = this.doc.terrain ? D().clone(this.doc.terrain)
          : { cols: 128, rows: 80, heights: Array(128 * 80).fill(-0.6) };
        this._paintingId = event.pointerId; this.container.setPointerCapture(event.pointerId);
      }
      if (!this._painting || event.pointerId !== this._paintingId) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (['pointercancel', 'lostpointercapture'].includes(event.type)) { this._painting = null; this._terrainData = null; this._terrain(); return; }
      if (event.type === 'pointerup') {
        const terrain = this._painting; this._painting = null;
        this.container.releasePointerCapture(event.pointerId);
        this.callbacks.action({ type: 'terrain', terrain }); return;
      }
      const [x, y] = this.xy(this.map.mouseEventToLatLng(event));
      const t = this._painting, radius = this.brushSize || 70;
      for (let row = 0; row < t.rows; row++) for (let col = 0; col < t.cols; col++) {
        if (Math.hypot(col / (t.cols - 1) * this.doc.canvas.width - x, row / (t.rows - 1) * this.doc.canvas.height - y) <= radius) t.heights[row * t.cols + col] = this.tool === 'sea' ? -0.5 : 0.25;
      }
      this._terrain(t);
    }
    async exportPNG() {
      if (this.doc.coordinate_system !== 'local') throw new Error('PNG書き出しは創作地図で利用できます');
      const doc = { ...this.doc, display:root.MeldexMapDisplay.effective({...this.doc.display,...this.elementVisibility}), layers: this.doc.layers.map(l => ({ ...l, visible: this.layerVisibility?.[l.id] ?? l.visible })) }, periodId = this.periodId,
        featureKind = this.featureKind, filter = this.filter, ratio = Math.min(1, 4096 / Math.max(doc.canvas.width, doc.canvas.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.round(doc.canvas.width * ratio); canvas.height = Math.round(doc.canvas.height * ratio);
      const c = canvas.getContext('2d'); c.scale(ratio, ratio); c.fillStyle = '#ecede2'; c.fillRect(0, 0, doc.canvas.width, doc.canvas.height);
      if (doc.background||doc.atlas) { const image = new Image(); image.src = doc.atlas?root.MeldexMapAzgaar.url(doc.atlas,{resolution:Math.min(4090,canvas.width),display:doc.display}):doc.background.data_url; await image.decode(); c.drawImage(image, 0, 0, doc.canvas.width, doc.canvas.height); }
      if (doc.terrain) { c.globalAlpha = doc.background ? 0.7 : 1; c.drawImage(terrainCanvas(doc.terrain), 0, 0, doc.canvas.width, doc.canvas.height); c.globalAlpha = 1; }
      const labelFeatures=doc.features.filter(f=>root.MeldexMapDisplay.labels(f,doc.display)&&doc.layers.some(l=>l.id===f.layer_id&&l.visible&&l.opacity>0)&&D().visibleInPeriod(f,periodId)&&(!featureKind||f.kind===featureKind)&&(!filter||(f.label+' '+f.tags.join(' ')+' '+f.description).toLocaleLowerCase().includes(filter)));
      const textScale=doc.atlas?Math.max(1,Math.max(canvas.width,canvas.height)/1600):1;
      const labelPlan=doc.atlas?root.MeldexMapTerrainRender.labelLayout(labelFeatures,p=>p.map(n=>n*ratio),(text,cart)=>{c.font=`${cart.fontWeight||400} ${cart.fontSize}px sans-serif`;return c.measureText(text).width;},{bounds:[8,8,canvas.width-8,canvas.height-8],scale:textScale,forExport:true}):null;
      for (const layer of [...doc.layers].reverse().filter(l => l.visible)) for (const f of doc.features.filter(f => root.MeldexMapDisplay.visible(f,doc.display)&&f.layer_id === layer.id && D().visibleInPeriod(f, periodId)
        && (!featureKind || f.kind === featureKind) && (!filter || (f.label + ' ' + f.tags.join(' ') + ' ' + f.description).toLocaleLowerCase().includes(filter)))) {
        const cart = root.MeldexMapTerrainRender.style(f,textScale);
        c.globalAlpha = layer.opacity; c.strokeStyle = c.fillStyle = f.color; c.lineWidth = cart.weight / ratio; c.font = `${cart.fontWeight||400} ${cart.fontSize / ratio}px sans-serif`;
        c.setLineDash(cart.dash ? cart.dash.split(' ').map(Number).map(n=>n/ratio) : f.dashed ? [8/ratio,5/ratio] : []);
        if (f.kind === 'pin'&&root.MeldexMapDisplay.symbols(f,doc.display)) { if(root.MeldexMapTerrainRender.marker(f))root.MeldexMapTerrainRender.drawMarker(c,f,f.points[0],textScale/ratio,root.MeldexMapTerrainRender.symbol(f,SYMBOLS[f.icon]||SYMBOLS.pin));else if (cart.role === 'city') { c.save(); c.font = `${cart.symbolSize/ratio}px sans-serif`; c.textAlign='center'; c.textBaseline='middle'; c.fillText(root.MeldexMapTerrainRender.symbol(f,SYMBOLS[f.icon]||SYMBOLS.pin),...f.points[0]); c.restore(); } else c.fillText(SYMBOLS[f.icon] || SYMBOLS.pin, f.points[0][0], f.points[0][1]); }
        if (['route', 'region'].includes(f.kind)) {
          const points = D().drawPoints(f, doc);
          const g=root.MeldexMapAzgaar?.geometry(f);
          if(g){const path=new Path2D();path.addPath(new Path2D(g.path),new DOMMatrix([g.scale[0],0,0,g.scale[1],f.points[0][0]-g.anchor[0],f.points[0][1]-g.anchor[1]]));
            if(g.closed&&cart.role!=='border'){c.globalAlpha=layer.opacity*(cart.role==='river'?1:cart.fillOpacity);c.fill(path);c.globalAlpha=layer.opacity;}
            c.lineWidth=(cart.role==='river'?.2*textScale:cart.weight)/ratio;if(cart.weight>0)c.stroke(path);
          } else {
          c.beginPath(); points.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p));
          if (f.kind === 'region') { c.closePath(); c.globalAlpha = layer.opacity * cart.fillOpacity; c.fill(); c.globalAlpha = layer.opacity; }
          if(cart.weight>0)c.stroke();
          }
          if (f.kind === 'route' && f.arrow) {
            const a = points[points.length - 2], b = points[points.length - 1];
            c.save(); c.translate(...b); c.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
            c.beginPath(); c.moveTo(0, 0); c.lineTo(-16 / ratio, -7 / ratio); c.lineTo(-16 / ratio, 7 / ratio); c.closePath(); c.fill(); c.restore();
          }
        }
        if (f.label && cart.label&&root.MeldexMapDisplay.labels(f,doc.display)&&(!labelPlan||!cart.role||labelPlan.get(f.id)?.visible)) { const marker=root.MeldexMapTerrainRender.marker(f);let x=f.points[0][0]+(f.kind==='pin'?(marker?(marker.width/2+6)*textScale:cart.role==='city'?cart.symbolSize/2+4:18*textScale)/ratio:0);let y=f.points[0][1]+(marker?(marker.centerY-marker.anchorY)*textScale/ratio:0);if(marker)c.textBaseline='middle';const width=c.measureText(f.label).width;
          if(cart.role&&f.kind==='label')x-=width/2;
          if(cart.role==='city'&&x+width>doc.canvas.width-12/ratio)x=f.points[0][0]-(cart.symbolSize/2+4)/ratio-width;
          if(cart.role)x=Math.max(12/ratio,Math.min(doc.canvas.width-width-12/ratio,x));
          if(labelPlan&&cart.role){const plan=labelPlan.get(f.id);x=f.points[0][0]+plan.dx/ratio;y=f.points[0][1]+plan.dy/ratio;c.textBaseline='middle';}
          if(cart.role){c.save();c.setLineDash([]);c.strokeStyle='rgba(255,255,244,.8)';c.lineWidth=2.5/ratio;c.strokeText(f.label,x,y);c.restore();} c.fillText(f.label,x,y);c.textBaseline='alphabetic'; }
      }
      c.globalAlpha = 1; c.setLineDash([]); c.resetTransform(); c.fillStyle = 'rgba(255,255,255,.86)'; c.fillRect(16, canvas.height - 67, 205, 50);
      const per100 = 100 / ratio * (doc.scale.distance_per_unit || 1), bar = D().scaleBar(per100);
      c.fillStyle = c.strokeStyle = '#26313b'; c.lineWidth = 2; c.font = '14px sans-serif';
      c.fillText(D().distanceLabel(bar.distance, doc), 24, canvas.height - 45);
      c.beginPath(); c.moveTo(24, canvas.height - 38); c.lineTo(24, canvas.height - 32); c.lineTo(24 + bar.pixels, canvas.height - 32); c.lineTo(24 + bar.pixels, canvas.height - 38); c.stroke();
      if (!doc.scale.distance_per_unit) { c.font = '11px sans-serif'; c.fillText('縮尺未設定', 135, canvas.height - 30); }
      c.save(); c.translate(canvas.width - 48, 50); c.rotate(doc.scale.north_degrees * Math.PI / 180);
      c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.fillText('N', 0, -12); c.fillText('▲', 0, 12); c.restore();
      const period = (doc.periods || []).find(item => item.id === periodId);
      if (period) { c.fillStyle = '#26313b'; c.font = '16px sans-serif'; c.fillText(period.name, 20, 30, Math.max(1, canvas.width - 100)); }
      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      this.interaction.destroy();
      this._observer.disconnect();
      const map = this.map; this.map = null; removeMap(map);
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => this.container.removeEventListener(type, this._pointer, true));
    }
  }
  root.MeldexMapView = MapView;
})(globalThis);
