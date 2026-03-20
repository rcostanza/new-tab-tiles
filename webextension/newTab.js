const SNAP = 10;
const MAX_TITLE_LENGTH = 80;

const Theme = {
    apply: function(colors) {
        const root = document.documentElement;
        // toolbar is the most accurate for the bookmarks bar bg; fall back to frame
        const toolbarBg = colors.toolbar || colors.frame;
        if (toolbarBg) {
            root.style.setProperty('--bookmarks-toolbar-bg', toolbarBg);
            // Derive a slightly offset dropdown bg from toolbar color
            root.style.setProperty('--bookmarks-dropdown-bg', toolbarBg);
        }
        // toolbar_text takes priority over icons for text color
        const textColor = colors.toolbar_text || colors.icons || colors.tab_text;
        if (textColor) root.style.setProperty('--bookmarks-toolbar-text', textColor);
        // Use toolbar_top_separator or toolbar_field_border for divider
        const borderColor = colors.toolbar_top_separator || colors.toolbar_field_border;
        if (borderColor) root.style.setProperty('--bookmarks-toolbar-border', borderColor);
        // Derive hover bg from text color at low opacity
        if (textColor) root.style.setProperty('--bookmarks-item-hover-bg', `color-mix(in srgb, ${textColor} 10%, transparent)`);
    },
    detectAndApplyScheme: function() {
        // Detect system/OS color scheme preference (works on all browsers)
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');
        
        // Update folder icon sources based on color scheme
        const folderIcons = document.querySelectorAll('.bm-folder-icon');
        const api = Utils.isFirefox ? browser : chrome;
        folderIcons.forEach(icon => {
            icon.src = api.runtime.getURL(isDark ? "icons/folder.svg" : "icons/folder-light.svg");
        });
        
        // Update overflow icon source based on color scheme
        const overflowIcon = document.querySelector('.bm-overflow .bm-icon');
        if (overflowIcon) {
            overflowIcon.src = api.runtime.getURL(isDark ? "icons/overflow.svg" : "icons/overflow-light.svg");
        }
    },
    load: function() {
        // Detect OS color scheme on all browsers
        Theme.detectAndApplyScheme();
        
        // Listen for color scheme changes
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                Theme.detectAndApplyScheme();
            });
        }

        // For Firefox, also try to use the theme API for more accurate theme colors
        if (!Utils.isFirefox) return;
        
        const api = browser;
        if (!api.theme) return;
        try {
            api.theme.getCurrent((theme) => {
                if (theme && theme.colors) Theme.apply(theme.colors);
            });
        } catch (e) {
            console.warn('Theme API not available:', e);
        }
        if (api.theme.onUpdated) {
            api.theme.onUpdated.addListener((updateInfo) => {
                if (updateInfo.theme && updateInfo.theme.colors) Theme.apply(updateInfo.theme.colors);
            });
        }
    }
};

const Utils = {
    trimImageSize: function(image, width, height, format, maxSizeKB) {
        return new Promise((resolve, reject) => {
            if(!maxSizeKB) maxSizeKB = 200;
            if(!format) format = "png";
            if(image.length < maxSizeKB * 1024) {
                resolve(image);
                return;
            }
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                let quality = 1;

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                let dataUrl;
                do {
                    dataUrl = canvas.toDataURL(`image/${format}`, quality);
                    quality -= 0.1;
                } while (dataUrl.length > maxSizeKB * 1024 && quality > 0.1);

                resolve(dataUrl);
            };
            img.src = image;
        });
    },
    wait: function(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
    getFavicon: function(url) {
        if(Utils.isFirefox) {
        const regex = "(http[s]?://[^/]+).+",
            match = url.match(regex);
            baseUrl = match ? match[1] : null;
            domain = baseUrl ? baseUrl.split("//")[1].split(":")[0] : null;
            return `http://www.google.com/s2/favicons?domain=${domain}`;
        } else {
            const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
            faviconUrl.searchParams.set("pageUrl", url);
            faviconUrl.searchParams.set("size", "16");
            return faviconUrl.toString();
        }
    },
    isFirefox: typeof(browser) != "undefined"
}

const Canvas = {
    width: window.innerWidth,
    height: window.innerHeight,
    load: function() {
        Storage.get().then((data) => {
            document.body.style.backgroundImage = (data.canvas && data.canvas.backgroundImage) ? data.canvas.backgroundImage : null;
            for(let tile in data.tiles) Tile.create(null, data.tiles[tile]);
            Bookmarks.initToolbar();
        });
    },
    clear: function(force) {
        if(force == true || confirm("Are you sure?")) {
            const tiles = document.querySelectorAll('.tile');
            tiles.forEach((tile) => tile.remove());
            Storage.clearTiles();
            Toast.show("All tiles removed")
        }
    },
    isLocked: function() {
        return document.body.classList.contains("locked");
    },
    showContextMenu: function(event) {
        ContextMenu.show(event, ContextMenu.getDefaultItems());
    },
    toggleLock: function() {
        if(Canvas.isLocked()) {
            document.body.classList.remove('locked');
        } else {
            document.body.classList.add('locked');
            TileOptions.close();
        }

    },
    setBackground: function() {
        FilePicker.open("image/*")
            .then((image) => Utils.trimImageSize(image, window.innerWidth, window.innerHeight, "jpeg", 2000))
            .then((image) => {
                document.body.style.backgroundImage = `url(${image})`;
                Canvas.save();
            });
    },
    clearBackground: function() {
        document.body.style.backgroundImage = null;
        Canvas.save();
    },
    getData: function() {
        return {
            backgroundImage: document.body.style.backgroundImage || null,
        }
    },
    save: function() {
        Storage.saveCanvas(Canvas.getData());
    },
    appendChild: function(child) {
        document.body.appendChild(child);
    }
}

const ContextMenu = {
    getDefaultItems: function() {
        let items = [
            { label: 'New tile', action: Tile.create },
            { label: 'Clear all tiles', action: Canvas.clear }
        ];

        if(document.body.style.backgroundImage) {
            items.push({ label: 'Clear background', action: Canvas.clearBackground });
        } else {
            items.push({ label: 'Set background from file', action: Canvas.setBackground });
        }
        items.push(
            { label: 'Import', action: Storage.import },
            { label: 'Export', action: Storage.export },
            { label: 'Toggle bookmarks toolbar', action: Bookmarks.toggleToolbarState }
        );
        return items;
    },
    show: function(event, items) {
        if(Canvas.isLocked()) return;

        const menu = document.createElement('div');
        menu.classList.add('context-menu');
        for (let item of items) {
            const menuItem = document.createElement('div');
            menuItem.classList.add('menu-item');
            menuItem.innerText = item.label;
            menuItem.onmouseup = item.action;
            menu.appendChild(menuItem);
        }

        const existingMenu = document.querySelector('.context-menu');
        if (existingMenu) existingMenu.remove();

        Canvas.appendChild(menu);

        let x = event.clientX,
            y = event.clientY,
            menuWidth = menu.offsetWidth,
            menuHeight = menu.offsetHeight;

        if (x + menuWidth > window.innerWidth) x -= menuWidth;
        if (y + menuHeight > window.innerHeight) y -= menuHeight;

        menu.style.top = `${y}px`;
        menu.style.left = `${x}px`;

        document.addEventListener('click', ContextMenu.hide, { once: true });
    },
    hide: function() {
        const menu = document.querySelector('.context-menu');
        if (menu) menu.remove();
    }
}

const Tile = {
    undeleteStack: [],
    createOptions: function() {
        return {
            title: "",
            showTitle: false,
            url: "",
            parentTile: false,
            childrenDirection: "down",
            parentChildren: "list",
            childrenBookmarkList: "",
            childrenList: [],
        }
    },
    create: function(event, tileData) {
        const tile = document.createElement('a');
        tile.classList.add('tile');

        const sizeOverlay = document.createElement("div");
        sizeOverlay.classList.add("size-overlay");
        tile.appendChild(sizeOverlay);

        const tileHeader = document.createElement("div");
        tileHeader.classList.add("tile-header");
        tile.appendChild(tileHeader);

        let uuid;
        if (tileData) {
            uuid = tileData.id;
            tile.style.left = `${tileData.left}`;
            tile.style.top = `${tileData.top}`;
            tile.style.width = `${tileData.width}`;
            tile.style.height = `${tileData.height}`;
            if(tileData.backgroundImage) tile.style.backgroundImage = tileData.backgroundImage;
            tile.options = tileData.options || {};
            Tile.updateFromOptions(tile);
        } else {
            uuid = crypto.randomUUID()
            tile.style.left = `${event.clientX}px`;
            tile.style.top = `${event.clientY}px`;
            tile.options = {
                title: "",
                showTitle: false,
                url: "",
                opacity: 100,
                parentTile: false,
                childrenDirection: "down",
                parentChildren: "list",
                childrenBookmarkList: "",
                childrenList: [],
            }
        }
        tile.setAttribute('data-id', uuid);

        tile.addEventListener("mouseenter", Tile.showChildren);
        tile.addEventListener("mouseleave", Tile.hideChildren);
        tile.addEventListener("click", (event) => {
            if(!Canvas.isLocked()) event.preventDefault();
        });

        Canvas.appendChild(tile);
        Tile.updateOverlay(tile);
        return tile;
    },
    updateFromOptions: function(tile) {
        if(tile.options) {
            tile.setAttribute("data-title", tile.options.title);
            tile.style.opacity = tile.options.opacity/100;
            tile.options.showTitle ? tile.classList.add("show-title") : tile.classList.remove('show-title');
            if(tile.options.url.trim() != "") {
                tile.href = tile.options.url;
            } else {
                tile.removeAttribute("href");
            }
        }
    },
    updateOverlay: function(tile) {
        tile.querySelector('.size-overlay').innerText = `${tile.offsetWidth}x${tile.offsetHeight}`;
    },
    save: function(tile) {
        const relativeSize = Tile.getRelativeSize(tile);
        tile.style.width = `${relativeSize.width * 100}%`;
        tile.style.height = `${relativeSize.height * 100}%`;

        Storage.saveTile(Tile.getData(tile));
        if(tile.options) Tile.updateFromOptions(tile);
    },
    delete: function() {
        const tile = document.querySelector(".tile.selected"),
            title = tile.options.title,
            tileId = tile.getAttribute('data-id');

        if (!tileId) return;

        Tile.undeleteStack.push(Tile.getData(tile));
        Storage.deleteTile(tileId);
        tile.remove();

        TileOptions.close();

        const message = document.createElement("span");
        message.innerText = `${title || tileId} removed. `;

        const link = document.createElement("a");
        link.innerText = "(undo?)";
        link.href = "#";
        link.onclick = Tile.undelete;
        message.appendChild(link);

        Toast.show(message, 5);
    },
    undelete: function() {
        const lastAction = Tile.undeleteStack.pop();
        if (lastAction) {
            const tile = Tile.create(null, lastAction);
            Tile.save(tile);
            Toast.show(`Restored ${lastAction.options.title || lastAction.id}`);
        } else {
            Toast.show("Nothing to undelete");
        }
    },
    showChildren: function(event) {
        if(!Canvas.isLocked()) return;
        if(event.target.classList.contains(".children-overlay")) return;
        const tile = event.target.closest('.tile');
        if (tile && tile.options && tile.options.parentTile) {
            document.querySelectorAll(".children-overlay.visible").forEach((overlay) => overlay.classList.remove('visible'));
            let overlay = tile.querySelector('.children-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.classList.add('children-overlay');
                tile.appendChild(overlay);
            } else if(overlay.getAttribute('data-uid') == Tile.getChildrenUID(tile)) {
                overlay.classList.add('visible');
                return;
            }
            overlay.setAttribute('data-uid', Tile.getChildrenUID(tile));
            overlay.innerText = "";
            overlay.classList.forEach((name) => {
                if(name.startsWith("direction")) overlay.classList.remove(name);
            } );
            overlay.classList.add(`direction-${tile.options.parentChildrenDirection}`);

            let links = [];

            if (tile.options.parentChildren === 'list') {
                const childrenList = tile.options.childrenList.split('\n');
                childrenList.forEach(child => {
                    let [title, ...url] = child.split("|");
                    url = url.join("|");
                    links.push([title, url]);
                });
            } else if (tile.options.parentChildren === 'bookmarks') {
                const bookmarkFolderId = tile.options.childrenBookmarkList;
                Bookmarks.list[bookmarkFolderId].children.forEach(bookmark => {
                    if(bookmark.id == bookmarkFolderId || bookmark.type == "folder") return;
                    links.push([bookmark.title, bookmark.url]);
                });
            }

            for(let [title, url] of links) {
                const link = document.createElement('a');
                link.innerText = title.length > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) + '...' : title;
                link.href = url;

                const icon = document.createElement('img');
                icon.width = 16;
                icon.height = 16;
                icon.src = Utils.getFavicon(url);

                tile.options.parentChildrenDirection == "left" ? link.appendChild(icon) : link.prepend(icon);
                overlay.appendChild(link);
            };

            overlay.style.margin = "unset";
            overlay.style.left = "";
            overlay.style.top = "";

            overlay.style.display = "block";

            const offset = 10;

            switch(tile.options.parentChildrenDirection) {
                case 'down':
                    overlay.style.paddingTop = `${offset}px`;
                    overlay.style.top = `${tile.offsetHeight - offset}px`;
                    break;
                case 'up':
                    overlay.style.top = `${-overlay.offsetHeight - offset}px`;
                    overlay.style.paddingBottom = `${offset}px`;
                    break;
                case 'right':
                    overlay.style.paddingLeft = `${offset}px`;
                    overlay.style.left = `${tile.offsetWidth - offset}px`;
                    break;
                case 'left':
                    overlay.style.paddingRight = `${offset}px`;
                    overlay.style.left = `-${overlay.offsetWidth - offset}px`;
                    break;
            }

            overlay.style.display = null;

            setTimeout(() => {
                overlay.classList.add('visible');
            }, 100);
        }
    },
    hideChildren: function(event) {
        event.preventDefault();
        const tile = event.target.closest('.tile');
        if (tile) {
            const overlay = document.querySelector('.children-overlay.visible');
            if (overlay) overlay.classList.remove('visible');
        }
    },
    getChildrenUID: function(tile) {
        return `${tile.options.lastUpdate}`;
    },
    showContextMenu: function(event) {
        const tile = event.target.closest('.tile');
        const items = [
            { label: 'Options', action: TileOptions.open },
            { label: 'Delete', action: Tile.delete },
            { label: 'Set background from file', action: Tile.setBackground },
            { label: 'Set background from URL', action: Tile.setBackgroundFromUrl },
        ];
        if(tile.style.backgroundImage) items.push({ label: 'Clear background', action: Tile.clearBackground })
        ContextMenu.show(event, items);
    },
    select: function(event) {
        const tile = event.target.closest('.tile');
        const tiles = document.querySelectorAll('.tile');
        tiles.forEach(function(t) {
            if (t !== tile) t.classList.remove('selected');
        });
        if(tile) tile.classList.add('selected');
    },
    setBackground: function() {
        const tile = document.querySelector('.tile.selected');
        FilePicker.open("image/*")
            .then((image) => Utils.trimImageSize(image, 800, 600))
            .then((image) => {
                tile.style.backgroundImage = `url(${image})`;
                Tile.save(tile);
            });
    },
    setBackgroundFromUrl: function() {
        const url = prompt("Enter image URL");
        if(!url) {
            return;
        } else if(!url.startsWith("http")) {
            return alert("Invalid URL");
        } else if(!url.endsWith(".jpg") && !url.endsWith(".jpeg") && !url.endsWith(".png") && !url.endsWith(".svg")) {
            return alert("Only images are supported");
        }
        const tile = document.querySelector('.tile.selected');
        fetch(url)
            .then(response => response.blob())
            .then(blob => {
                const reader = new FileReader();
                reader.onload = function() {
                    Utils.trimImageSize(reader.result, 800, 600).then((image) => {
                        tile.style.backgroundImage = `url(${image})`;
                        Tile.save(tile);
                    });
                };
                reader.readAsDataURL(blob);
            })
            .catch(error => console.error('Error fetching image:', error));
    },
    clearBackground: function(event) {
        const tile = event.target.closest('.tile') || document.querySelector('.tile.selected');
        tile.style.backgroundImage = null;
        Tile.save(tile);
    },
    getData: function(tile) {
        const tileId = tile.getAttribute('data-id');
        return {
            id: tileId,
            left: tile.style.left,
            top: tile.style.top,
            width: tile.style.width,
            height: tile.style.height,
            backgroundImage: tile.style.backgroundImage || null,
            options: tile.options || {}
        }
    },
    getRelativeSize: function(tile) {
        const tileRect = tile.getBoundingClientRect(),
            canvasRect = document.body.getBoundingClientRect();
        return {
            width: tileRect.width / canvasRect.width + 0.0000001,
            height: tileRect.height / canvasRect.height + 0.0000001
        }
    },
}

const TileOptions = {
    initForm: function() {
        with(TileOptions.self()) {
            ondragstart = function() {
                return false;
            };

            function createOption(select, folder, depth = 0) {
                if(depth > 0) {
                    const option = document.createElement('option');
                    option.value = folder.id;
                    option.innerText = `${'~'.repeat(depth - 1)}> ${folder.title}`;
                    select.appendChild(option);
                }
                if (folder.children) {
                    folder.children.forEach(child => {
                        if(child.type == "folder") createOption(select, child, depth + 1);
                    });
                }
            }
            querySelector("#options-save").addEventListener("click", TileOptions.save);
            querySelector("#options-cancel").addEventListener("click", TileOptions.close);

            querySelector("#opacity").addEventListener("input", (event) => {
                querySelector("#opacity-value").innerText = `${event.target.value}%`;
            });

            querySelector("#parent-tile").addEventListener("change", (event) => {
                document.querySelector("#parent-options").style.display = event.target.checked ? "unset" : "none";
            });
            querySelector("#parent-children-list").addEventListener("change", (event) => {
                document.querySelector("#parent-children-list-list").style.display = event.target.checked ? "unset" : "none";
                document.querySelector("#parent-children-bookmarks-list").style.display = event.target.checked ? "none" : "unset";
            });
            querySelector("#parent-children-bookmarks").addEventListener("change", (event) => {
                document.querySelector("#parent-children-list-list").style.display = event.target.checked ? "none" : "unset";
                document.querySelector("#parent-children-bookmarks-list").style.display = event.target.checked ? "unset" : "none";
            });
            createOption(
                querySelector("#parent-children-bookmarks-list"),
                Bookmarks.list[0]
            );
        }

    },
    self: function() {
        return document.querySelector("#tile-options");
    },
    fields: function() {
        self = TileOptions.self();
        return {
            title: self.querySelector("#title"),
            showTitle: self.querySelector("#show-title"),
            url: self.querySelector("#url"),
            opacity: self.querySelector("#opacity"),
            parentTile: self.querySelector("#parent-tile"),
            parentOptions: self.querySelector("#parent-options"),
            parentChildrenDirection: self.querySelector("#parent-children-direction"),
            parentChildrenList: self.querySelector("#parent-children-list"),
            parentChildrenBookmarks: self.querySelector("#parent-children-bookmarks"),
            parentChildrenListList: self.querySelector("#parent-children-list-list"),
            parentChildrenBookmarksList: self.querySelector("#parent-children-bookmarks-list"),
        }
    },
    open: function(event) {
        const tile = event.target.closest('.tile') || document.querySelector('.tile.selected');

        with(TileOptions.fields()) {
            title.value = tile.options.title || "";
            url.value = tile.options.url || "";
            opacity.value = tile.options.opacity || 100;
            showTitle.checked = tile.options.showTitle == true;
            parentTile.checked = tile.options.parentTile;
            parentOptions.style.display = tile.options.parentTile ? "unset" : "none";
            parentChildrenDirection.value = tile.options.parentChildrenDirection || "down";

            opacity.dispatchEvent(new Event('input'))

            if(tile.options.parentChildren == "list") {
                parentChildrenList.checked = true;
                parentChildrenList.dispatchEvent(new Event('change'));
            } else {
                parentChildrenBookmarks.checked = true;
                parentChildrenBookmarks.dispatchEvent(new Event('change'));
            }

            parentChildrenListList.value = tile.options.childrenList || "";
            parentChildrenBookmarksList.value = tile.options.childrenBookmarkList || "";
        }

        with(TileOptions.self()) {
            setAttribute('data-tile-id', tile.getAttribute('data-id'));

            style.display = "unset";

            const tileRect = tile.getBoundingClientRect(),
                canvasRect = document.body.getBoundingClientRect(),
                optionsRect = getBoundingClientRect();

            let left, top;

            if(tileRect.right + optionsRect.width > canvasRect.right) {
                left = tileRect.left - optionsRect.width - 10;
            } else {
                left = tileRect.right + 10;
            }

            if(tileRect.bottom + optionsRect.height > canvasRect.bottom) {
                top = tileRect.bottom - optionsRect.height;
            } else {
                top = tileRect.top;
            }

            style.top = `${top}px`;
            style.left = `${left}px`;
        }
    },
    close: function() {
        with(TileOptions.self().style) {
            display = "none";
            left = null;
            top = null;
        }
    },
    save: function() {
        const modal = TileOptions.self(),
            tile = document.querySelector(`.tile[data-id="${modal.getAttribute('data-tile-id')}"]`),
            fields = TileOptions.fields();

        const title = fields.title.value.trim(),
            url = fields.url.value.trim(),
            opacity = fields.opacity.value,
            showTitle = fields.showTitle.checked,
            parentTile = fields.parentTile.checked,
            parentChildrenDirection = fields.parentChildrenDirection.value || "down",
            parentChildrenList = fields.parentChildrenList.checked,
            parentChildrenListList = fields.parentChildrenListList.value,
            parentChildrenBookmarksList = fields.parentChildrenBookmarksList.value;

        tile.options = {
            title: title,
            showTitle: showTitle,
            url: url,
            opacity: opacity,
            parentTile: parentTile,
            parentChildrenDirection: parentChildrenDirection,
            parentChildren: parentChildrenList ? "list" : "bookmarks",
            childrenBookmarkList: parentChildrenBookmarksList,
            childrenList: parentChildrenListList.trim(),
            lastUpdate: new Date().getUTCMilliseconds(),
        };

        Tile.updateFromOptions(tile);

        Tile.save(tile);
        TileOptions.close();
    },
}

const Storage = {
    _: Utils.isFirefox ? browser.storage.local : chrome.storage.local,
    get: function(fn) {
        return Storage._.get();
    },
    setOption: function(key, value) {
        return Storage._.get("canvas").then((data) => {
            data.canvas[key] = value;
            Storage.saveCanvas(data.canvas);
        });
    },
    saveTile: function(tileData) {
        Storage.getTiles((data) => {
            data[tileData.id] = tileData;
            Storage.saveTiles(data);
        });
    },
    saveTiles: function(data, fn) {
        Storage._.set({ tiles: data }).then(fn);
    },
    getTiles: function(fn) {
        Storage._.get("tiles").then((data) => fn(data.tiles || {}));
    },
    getBookmarksToolbarState: function(fn) {
        Storage._.get("canvas").then((data) => {
            console.log(data);
            fn(data.canvas.bookmarksToolbarEnabled || false);
        });
    },
    setBookmarksToolbarState: function(state, fn) {
        Storage.setOption("bookmarksToolbarEnabled", state).then(fn);
    },
    deleteTile: function(id) {
        Storage.getTiles((data) => {
            delete data[id];
            Storage.saveTiles(data);
        });
    },
    clearTiles: function() {
        Storage._.clear();
    },
    saveCanvas: function(data) {
        return Storage._.set({ "canvas": data });
    },
    export: function() {
        Storage.get().then((data) => {
            const json = JSON.stringify([data]),
                blob = new Blob([json], { type: 'application/json' }),
                url = URL.createObjectURL(blob),
                a = document.createElement('a');
            a.href = url;
            a.download = 'tiles.json';
            a.click();
            URL.revokeObjectURL(url);
        });
    },
    import: function() {
        FilePicker.open("application/json").then((jsonString) => {
            const json = JSON.parse(jsonString);
            if(json.length == 0) return;
            Storage.saveTiles(json[0]["tiles"]);
            Storage.saveCanvas(json[0]["canvas"] || {});
            location.reload();
        });
    },
}

const Bookmarks = {
    TOOLBAR_FOLDER_ID: Utils.isFirefox ? "toolbar_____" : "1",
    load: function() {
        return Bookmarks.getFolders().then(folders => {
            for(let folder of folders) {
                const isRoot = folder.id === "root________" || folder.id === "0";
                const folderID = isRoot ? 0 : folder.id;
                Bookmarks.list[folderID] = folder;
            }
            if (document.querySelector("#bookmarksToolbar.visible")) {
                Bookmarks.renderToolbar();
            }
        });
    },
    getFolders: function() {
        const bookmarks = Utils.isFirefox ? browser.bookmarks : chrome.bookmarks;
        return bookmarks.getTree().then((tree) => {
            const folders = [];
            function getFolders(node) {
                if (node.children || node.type === 'folder') {
                    folders.push(node);
                    if(typeof(node.type) == "undefined") node.type = "folder";
                }
                if (node.children) {
                    node.children.forEach(getFolders);
                }
            }
            tree.forEach(getFolders);
            return folders;
        });
    },
    toggleToolbarState: function() {
        Storage.getBookmarksToolbarState((isToolbarEnabled) => {
            Storage.setBookmarksToolbarState(!isToolbarEnabled);
            Bookmarks.toggleToolbar(!isToolbarEnabled);
        });
    },
    initToolbar: function() {
        // Called on page load — applies toolbar state without animation
        Storage.getBookmarksToolbarState((state) => {
            let toolbar = document.querySelector("#bookmarksToolbar");
            if (!state) {
                document.body.classList.remove("bookmarksToolbarEnabled");
                toolbar.classList.remove("visible");
            } else {
                document.body.classList.add("bookmarksToolbarEnabled");
                toolbar.classList.add("visible");
                Bookmarks.renderToolbar();
            }
        });
    },
    toggleToolbar: function(state) {
        if(state == null) {
            Storage.getBookmarksToolbarState(this.toggleToolbar);
            return;
        }
        let toolbar = document.querySelector("#bookmarksToolbar");
        toolbar.classList.add("bm-animate");
        if(!state) {
            document.body.classList.remove("bookmarksToolbarEnabled");
            toolbar.classList.remove("visible");
        } else {
            document.body.classList.add("bookmarksToolbarEnabled");
            toolbar.classList.add("visible");
            Bookmarks.renderToolbar();
        };
    },
    renderToolbar: function() {
        const toolbar = document.querySelector("#bookmarksToolbar");
        if (!toolbar.classList.contains("visible")) return;
        toolbar.innerHTML = "";
        const toolbarFolder = Bookmarks.list[Bookmarks.TOOLBAR_FOLDER_ID];
        if (!toolbarFolder || !toolbarFolder.children) return;
        for (const bookmark of toolbarFolder.children) {
            const el = Bookmarks.createItem(bookmark, false);
            if (el) toolbar.appendChild(el);
        }
        requestAnimationFrame(Bookmarks.handleOverflow);
    },
    createItem: function(bookmark, isDropdown) {
        const isFolder = bookmark.type === "folder" || (bookmark.children !== undefined && bookmark.type !== "bookmark");
        let el;
        if (bookmark.type === "separator") {
            el = document.createElement("div");
            el.classList.add(isDropdown ? "bm-dropdown-separator" : "bm-toolbar-separator");
        } else if (isFolder) {
            el = Bookmarks.createFolderItem(bookmark, isDropdown);
        } else {
            el = Bookmarks.createBookmarkItem(bookmark, isDropdown);
        }
        el._bookmarkData = bookmark;
        return el;
    },
    createBookmarkItem: function(bookmark, isDropdown) {
        const a = document.createElement("a");
        a.classList.add(isDropdown ? "bm-dropdown-item" : "bm-toolbar-item", "bm-bookmark");
        a.href = bookmark.url || "#";
        const url = bookmark.url || "";
        const truncatedUrl = url.length > 100 ? url.slice(0, 100) + "..." : url;
        a.title = bookmark.title ? `${bookmark.title}\n${truncatedUrl}` : truncatedUrl;
        const icon = document.createElement("img");
        icon.classList.add("bm-icon");
        icon.width = 16;
        icon.height = 16;
        if (bookmark.url) icon.src = Utils.getFavicon(bookmark.url);
        icon.onerror = function() { this.style.display = "none"; };
        a.appendChild(icon);
        const label = document.createElement("span");
        label.classList.add("bm-label");
        label.textContent = bookmark.title || bookmark.url || "";
        a.appendChild(label);
        return a;
    },
    createFolderItem: function(folder, isDropdown) {
        const div = document.createElement("div");
        div.classList.add(isDropdown ? "bm-dropdown-item" : "bm-toolbar-item", "bm-folder");
        div.title = folder.title || "";
        const icon = document.createElement("img");
        icon.classList.add("bm-folder-icon");
        icon.width = 18;
        icon.height = 18;
        const api = Utils.isFirefox ? browser : chrome;
        const isLightMode = document.documentElement.getAttribute('data-color-scheme') === 'light';
        icon.src = api.runtime.getURL(isLightMode ? "icons/folder-light.svg" : "icons/folder.svg");
        div.appendChild(icon);
        const label = document.createElement("span");
        label.classList.add("bm-label");
        label.textContent = folder.title || "";
        div.appendChild(label);
        if (folder.children && folder.children.length > 0) {
            const dropdown = document.createElement("div");
            dropdown.classList.add("bm-dropdown");
            for (const child of folder.children) {
                const childEl = Bookmarks.createItem(child, true);
                if (childEl) dropdown.appendChild(childEl);
            }
            Bookmarks.setupDropdownScroll(dropdown);
            if (!isDropdown) {
                div.appendChild(dropdown);
            } else {
                div._subDropdown = dropdown;
            }
        }
        if (!isDropdown) {
            // Toolbar folder: click to toggle open/close
            div.addEventListener("click", function(e) {
                e.stopPropagation();
                const isOpen = div.classList.contains("open");
                Bookmarks.closeAllDropdowns();
                if (!isOpen) {
                    div.classList.add("open");
                    document.addEventListener("click", Bookmarks.closeAllDropdowns, { once: true });
                }
            });
            // Hover-switch when another toolbar folder is already open
            div.addEventListener("mouseenter", function() {
                const toolbar = document.querySelector("#bookmarksToolbar");
                const anyOpen = toolbar && toolbar.querySelector(".bm-toolbar-item.bm-folder.open");
                if (anyOpen && anyOpen !== div) {
                    anyOpen.classList.remove("open");
                    div.classList.add("open");
                }
            });
        } else if (div._subDropdown) {
            const sub = div._subDropdown;
            const closeThisPortal = () => {
                // Remove sub and any of its descendant portals, but not sibling portals
                document.querySelectorAll(".bm-dropdown-portal").forEach(p => {
                    let ancestor = p;
                    while (ancestor) {
                        if (ancestor === sub) { p.remove(); return; }
                        ancestor = ancestor._parentPortal;
                    }
                });
            };
            const cancelClose = () => { clearTimeout(sub._closeTimer); sub._closeTimer = null; };
            const scheduleClose = () => { sub._closeTimer = setTimeout(closeThisPortal, 150); };
            sub.addEventListener("mouseenter", function() {
                cancelClose();
                Bookmarks.cancelAncestorPortalClosers(sub);
            });
            sub.addEventListener("mouseleave", scheduleClose);
            div.addEventListener("mouseenter", function() {
                cancelClose();
                Bookmarks.cancelAncestorPortalClosers(div.closest(".bm-dropdown-portal"));
                // Remove sibling portals (not in this item's ancestor chain)
                const ancestors = new Set();
                let a = div.closest(".bm-dropdown-portal");
                while (a) { ancestors.add(a); a = a._parentPortal; }
                document.querySelectorAll(".bm-dropdown-portal").forEach(p => {
                    if (!ancestors.has(p)) p.remove();
                });
                if (sub.parentNode !== document.body) {
                    Bookmarks.openPortalDropdown(div, sub);
                }
            });
            div.addEventListener("mouseleave", scheduleClose);
        }
        return div;
    },
    setupDropdownScroll: function(dropdown) {
        const scrollArea = document.createElement("div");
        scrollArea.classList.add("bm-dropdown-scroll-area");
        while (dropdown.firstChild) scrollArea.appendChild(dropdown.firstChild);
        const topArrow = document.createElement("div");
        topArrow.classList.add("bm-scroll-arrow", "bm-scroll-up");
        topArrow.textContent = "\u25B2";
        const btmArrow = document.createElement("div");
        btmArrow.classList.add("bm-scroll-arrow", "bm-scroll-down");
        btmArrow.textContent = "\u25BC";
        dropdown.appendChild(topArrow);
        dropdown.appendChild(scrollArea);
        dropdown.appendChild(btmArrow);
        dropdown._scrollArea = scrollArea;
        dropdown._updateScrollArrows = function() {
            topArrow.classList.toggle("visible", scrollArea.scrollTop > 0);
            btmArrow.classList.toggle("visible",
                scrollArea.scrollTop + scrollArea.clientHeight < scrollArea.scrollHeight - 1);
        };
        let scrollInterval = null;
        const stopScroll = () => { clearInterval(scrollInterval); scrollInterval = null; };
        const startScroll = (dir) => {
            stopScroll();
            scrollInterval = setInterval(() => {
                scrollArea.scrollTop += dir * 8;
                dropdown._updateScrollArrows();
            }, 16);
        };
        topArrow.addEventListener("mouseenter", () => startScroll(-1));
        topArrow.addEventListener("mouseleave", stopScroll);
        btmArrow.addEventListener("mouseenter", () => startScroll(1));
        btmArrow.addEventListener("mouseleave", stopScroll);
        scrollArea.addEventListener("scroll", dropdown._updateScrollArrows);
        dropdown.addEventListener("mouseenter", dropdown._updateScrollArrows);
    },
    openPortalDropdown: function(anchor, dropdown) {
        dropdown._parentPortal = anchor.closest(".bm-dropdown-portal") || null;
        dropdown.classList.add("bm-dropdown-portal");
        // Set position before appending so transition doesn't animate from 0,0
        dropdown.style.cssText = "position:fixed;visibility:hidden;display:block;top:0;left:0;transition:none";
        document.body.appendChild(dropdown);
        const anchorRect = anchor.getBoundingClientRect();
        const ddRect = dropdown.getBoundingClientRect();
        let left = anchorRect.right;
        let top = anchorRect.top;
        if (left + ddRect.width > window.innerWidth) left = anchorRect.left - ddRect.width;
        if (top + ddRect.height > window.innerHeight) top = window.innerHeight - ddRect.height;
        dropdown.style.left = `${left}px`;
        dropdown.style.top = `${top}px`;
        dropdown.style.visibility = "";
        if (dropdown._updateScrollArrows) dropdown._updateScrollArrows();
    },
    cancelAncestorPortalClosers: function(portal) {
        while (portal) {
            if (portal._closeTimer) { clearTimeout(portal._closeTimer); portal._closeTimer = null; }
            portal = portal._parentPortal;
        }
    },
    closePortals: function() {
        document.querySelectorAll(".bm-dropdown-portal").forEach(el => el.remove());
    },
    closeAllDropdowns: function() {
        document.querySelectorAll(".bm-folder.open").forEach(f => f.classList.remove("open"));
        Bookmarks.closePortals();
    },
    handleOverflow: function() {
        const toolbar = document.querySelector("#bookmarksToolbar");
        if (!toolbar) return;
        
        // Remove any existing overflow button
        toolbar.querySelector(".bm-overflow")?.remove();
        
        // Get all visible items
        const items = [...toolbar.querySelectorAll(":scope > .bm-toolbar-item, :scope > .bm-toolbar-separator")].filter(item => !item.classList.contains("bm-overflow"));
        
        if (items.length === 0) return;
        
        // Show all items temporarily to measure
        items.forEach(item => { item.style.display = ""; });
        
        // Force layout update
        toolbar.offsetWidth;
        
        const maxWidth = window.innerWidth;
        const OVERFLOW_BTN_WIDTH = 70;
        const TOOLBAR_PADDING = 8;
        
        // Calculate which items overflow
        let overflowStart = -1;
        let accumulatedWidth = TOOLBAR_PADDING;
        
        for (let i = 0; i < items.length; i++) {
            const itemWidth = items[i].offsetWidth + 1; // +1 for gap
            const projectedTotal = accumulatedWidth + itemWidth + OVERFLOW_BTN_WIDTH;
            
            if (projectedTotal > maxWidth) {
                overflowStart = i;
                break;
            }
            accumulatedWidth += itemWidth;
        }
        
        // No overflow needed
        if (overflowStart === -1) return;
        
        // Hide overflowing items
        const overflowItems = items.slice(overflowStart);
        overflowItems.forEach(item => { item.style.display = "none"; });
        
        console.log(`Overflow triggered at item ${overflowStart} of ${items.length}, maxWidth: ${maxWidth}, accumulated: ${accumulatedWidth}`);
        
        // Create overflow button
        const overflowBtn = document.createElement("div");
        overflowBtn.classList.add("bm-toolbar-item", "bm-folder", "bm-overflow");
        overflowBtn.title = "More bookmarks";
        const overflowIcon = document.createElement("img");
        overflowIcon.classList.add("bm-icon");
        overflowIcon.width = 16;
        overflowIcon.height = 16;
        const api = Utils.isFirefox ? browser : chrome;
        const isLightMode = document.documentElement.getAttribute('data-color-scheme') === 'light';
        overflowIcon.src = api.runtime.getURL(isLightMode ? "icons/overflow-light.svg" : "icons/overflow.svg");
        overflowIcon.style.filter = "var(--bookmarks-icon-filter, none)";
        overflowBtn.appendChild(overflowIcon);
        
        const overflowDropdown = document.createElement("div");
        overflowDropdown.classList.add("bm-dropdown");
        overflowItems.forEach(item => {
            if (item._bookmarkData) {
                const dropdownItem = Bookmarks.createItem(item._bookmarkData, true);
                if (dropdownItem) overflowDropdown.appendChild(dropdownItem);
            }
        });
        Bookmarks.setupDropdownScroll(overflowDropdown);
        overflowBtn.appendChild(overflowDropdown);
        toolbar.appendChild(overflowBtn);
        
        overflowBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            const isOpen = overflowBtn.classList.contains("open");
            Bookmarks.closeAllDropdowns();
            if (!isOpen) {
                overflowBtn.classList.add("open");
                document.addEventListener("click", Bookmarks.closeAllDropdowns, { once: true });
            }
        });
    },
    list: {}
}

const Toast = {
    show: function(messageOrTag, timeout) {
        if(!timeout) timeout = 3;
        const toast = document.querySelector(".toast"),
            messageContainer = toast.querySelector(".message");

        if(typeof(message) != "string") {
            messageContainer.replaceChildren(messageOrTag);
        } else {
            messageContainer.innerText = message;
        }
        toast.classList.add("show");
        clearTimeout(Toast._timeout);
        Toast._timeout = setTimeout(() => toast.classList.remove("show"), timeout * 1000);
    },
}

const FilePicker = {
    open: function(accept) {
        return new Promise((resolve, reject) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = accept;
            input.onchange = function(event) {
                const file = event.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = (e) => reject(e);
                    if(accept.includes("image")) {
                        reader.readAsDataURL(file);
                    } else {
                        reader.readAsText(file);
                    }
                } else {
                    reject(new Error("No file selected"));
                }
            };
            input.click();
        });
    }
}

document.addEventListener('contextmenu', function(event) {
    event.preventDefault();

    if(event.target == document.body) {
        Canvas.showContextMenu(event);
    } else if (event.target.closest('.tile')) {
        Tile.showContextMenu(event);
    }
});

document.addEventListener('mousedown', function(event) {
    const tile = event.target.closest(".tile");
    if (tile || (event.target == document.body)) Tile.select(event);
    if (event.button !== 0) return;
    if (tile && !Canvas.isLocked()) {
        tile.classList.add("dragging");

        let shiftX = event.clientX - tile.getBoundingClientRect().left;
        let shiftY = event.clientY - tile.getBoundingClientRect().top;

        let offsetX = (Canvas.width/2) % SNAP, offsetY = (Canvas.height/2) % SNAP;

        function onMouseMove(event) {
            const snappedX = (Math.round((event.pageX - shiftX) / SNAP) * SNAP) + offsetX;
            const snappedY = (Math.round((event.pageY - shiftY) / SNAP) * SNAP) + offsetY;
            tile.style.left = snappedX + 'px';
            tile.style.top = snappedY + 'px';
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseMove);
            const tile = document.querySelector(".tile.dragging");
            if (tile && !Canvas.isLocked()) {
                tile.classList.remove("dragging");
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;
                const tileRect = tile.getBoundingClientRect();

                const leftPercent = (tileRect.left / viewportWidth) * 100;
                const topPercent = (tileRect.top / viewportHeight) * 100;

                tile.style.left = `${leftPercent}%`;
                tile.style.top = `${topPercent}%`;

                Tile.save(tile);
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }
});

document.addEventListener('dragstart', function(event) {
    event.preventDefault();
});

document.addEventListener('wheel', function(event) {
    if (event.shiftKey && event.target.closest('.tile')) {
        event.preventDefault();
        const tile = event.target.closest('.tile'),
            rect = tile.getBoundingClientRect(),
            width = parseInt(rect.width),
            height = parseInt(rect.height);

        if (event.deltaY < 0) { // Scroll up
            if(!event.ctrlKey) tile.style.width = `${(width + SNAP) - (width % SNAP)}px`;
            tile.style.height = `${(height + SNAP) - (height % SNAP)}px`;
        } else { // Scroll down
            if(!event.ctrlKey) tile.style.width = `${(width - SNAP) - (width % SNAP)}px`;
            tile.style.height = `${(height - SNAP) - (height % SNAP)}px`;
        }
        Tile.save(tile);
        Tile.updateOverlay(tile);
    }
});

document.addEventListener('auxclick', function(event) {
    const tile = event.target.closest('.tile');
    if (event.button === 1 && tile) {
        if(!Canvas.isLocked()) {
            event.preventDefault();
            tile.style.width = null; // Default width
            tile.style.height = null; // Default height
            Tile.updateOverlay(tile);
            Tile.save(tile);
        }
    }
});

document.addEventListener('DOMContentLoaded', function() {
    Theme.load();
    Canvas.load();
    Bookmarks.load().then(TileOptions.initForm);
});

document.addEventListener('dblclick', function(event) {
    if(event.target == document.body) Canvas.toggleLock();
});

window.addEventListener("resize", function() {
    const windowWidth = window.innerWidth, windowHeight = window.innerHeight;

    Canvas.width = windowWidth;
    Canvas.height = windowHeight;

    for(let tile of document.querySelectorAll('.tile')) {
        Tile.updateOverlay(tile);
    }
    Bookmarks.handleOverflow();
});
