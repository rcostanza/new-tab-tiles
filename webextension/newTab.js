const SNAP = 10;

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
        );
        ContextMenu.show(event, items);
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

            if (tile.options.parentChildren === 'list') {
                const childrenList = tile.options.childrenList.split('\n');
                childrenList.forEach(child => {
                    let [text, ...link] = child.split("|");
                    link = link.join("|");
                    const childDiv = document.createElement("A");
                    childDiv.textContent = text;
                    if(link) childDiv.href = link;
                    overlay.appendChild(childDiv);
                });
            } else if (tile.options.parentChildren === 'bookmarks') {
                const bookmarkFolderId = tile.options.childrenBookmarkList;
                const bookmarks = Bookmarks.list[bookmarkFolderId].children;
                bookmarks.forEach(bookmark => {
                    if(bookmark.id == bookmarkFolderId || bookmark.type == "folder") return;
                    const bookmarkLink = document.createElement('a');
                    bookmarkLink.innerText = bookmark.title.length > 50 ? bookmark.title.substring(0, 50) + '...' : bookmark.title;
                    bookmarkLink.href = bookmark.url;

                    const bookmarkIcon = document.createElement('img');
                    bookmarkIcon.width = 16;
                    bookmarkIcon.height = 16;
                    bookmarkIcon.src = Utils.getFavicon(bookmark.url);

                    if(tile.options.parentChildrenDirection == "left") {
                        bookmarkLink.appendChild(bookmarkIcon);
                    } else {
                        bookmarkLink.prepend(bookmarkIcon);
                    }
                    overlay.appendChild(bookmarkLink);
                });
            }

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
    load: function() {
        return Bookmarks.getFolders().then(folders => {
            for(let folder of folders) {
                const folderID = folder.id == "root________" ? 0 : folder.id;
                Bookmarks.list[folderID] = folder;
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
});
