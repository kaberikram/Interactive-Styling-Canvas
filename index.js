// --- Image Preloading Function ---
// Preloads an array of image paths to prevent flickering or delays when they are first displayed.
function preloadImages(imageArray, callback) {
    let loadedCount = 0;
    const totalImages = imageArray.length;

    if (totalImages === 0) {
        callback();
        return;
    }

    imageArray.forEach(path => {
        const img = new Image();
        img.onload = () => {
            loadedCount++;
            if (loadedCount === totalImages) {
                callback();
            }
        };
        img.onerror = () => {
            loadedCount++; // Count errors as "loaded" to not block forever
            console.warn(`Failed to load image: ${path}`);
            if (loadedCount === totalImages) {
                callback();
            }
        };
        img.src = path;
    });
}
// --- End Image Preloading Function ---



document.addEventListener('DOMContentLoaded', () => {
    // This event fires when the initial HTML document has been completely loaded and parsed,
    // without waiting for stylesheets, images, and subframes to finish loading.
    
    // --- DOM Element Selections ---
    const shirts = document.querySelectorAll('.shirt'); // Select all elements with the class 'shirt' (product images)
    const centerImage = document.getElementById('centerImage'); // Select the main display image element
    const infoTooltip = document.getElementById('info-tooltip'); // Select the tooltip element

    // --- Configuration and Constants ---
    const MODEL_INFO = { // Stores information about the model, currently only height.
        mouse: { height: '5ft 4"' } 
    };

    // --- State Variables ---
    let currentMode = 'mouse'; // Intended for future use, perhaps to switch between different model types or interaction modes.
    const validHoverPaths = []; // Stores absolute URL pathnames for valid hover images (e.g., ".../1ModelHover.png"). Used to ensure we only attempt to load existing hover images.

    // --- Image Path Collection and Preloading ---
    // Gather all potential image sources from the HTML to preload them.
    // This includes product images, model images, and their hover variations.
    const imagePaths = [];
    shirts.forEach(shirt => {
        const shirtSrc = shirt.getAttribute('src'); // Product image
        const mouseSrc = shirt.getAttribute('data-mouse-src'); // Model image associated with the product
        
        if (shirtSrc) imagePaths.push(shirtSrc);
        if (mouseSrc) {
            imagePaths.push(mouseSrc);
            // Derive the hover image path by replacing 'Model.png' with 'ModelHover.png'
            const hoverSrc = mouseSrc.replace('Model.png', 'ModelHover.png');
            if (hoverSrc !== mouseSrc) { // Ensure a replacement actually happened
                 imagePaths.push(hoverSrc);
                 try {
                    // Store the absolute pathname of valid hover images for quick lookup.
                    validHoverPaths.push(new URL(hoverSrc, window.location.href).pathname);
                 } catch (e) {
                    console.warn(`Could not create URL for hover image: ${hoverSrc}`, e)
                 }
            }
        }
    });
    
    // Add the initial center image source to the list of paths to preload.
    if (centerImage && centerImage.src) {
        imagePaths.push(centerImage.src);
    }
        
    // Create a unique set of absolute image pathnames for preloading.
    // This prevents attempting to preload the same image multiple times.
    const uniqueImagePaths = [...new Set(imagePaths)]
    .map(path => {
        if (!path) return null;
        try {
            // Ensure paths like '1Model.png' correctly resolve to absolute paths for preloading.
            // And paths like '1ModelHover.png' derived from data attributes are also resolved.
            return new URL(path, window.location.href).href; // Use .href to get the full URL for Image().src
        } catch (e) {
            console.warn('Error converting path to URL for preloading:', path, e);
            return path; 
        }
    })
    .filter(Boolean);
    
    preloadImages(uniqueImagePaths, () => {
        document.body.classList.remove('loading');
        console.log('All images preloaded, loading class removed.');
    }); // Preload all collected unique image paths and remove loading class on completion.

    // --- Drag-and-Drop State Variables ---
    let activeShirt = null; // The shirt element currently being dragged.
    let initialShirtPos = { left: '', top: '' }; // Stores the original CSS 'left' and 'top' values of the shirt before dragging.
    let initialTouchPos = { x: 0, y: 0 }; // Stores the initial X and Y coordinates of the mouse/touch when a drag starts.
    let currentPos = { x: 0, y: 0 }; // Stores the current calculated X and Y position of the dragging shirt.
    let lastX = 0; // Stores the last X coordinate during a move event, used to calculate deltaX.
    let lastY = 0; // Stores the last Y coordinate during a move event, used to calculate deltaY.
    let isMoving = false; // Flag to indicate if the shirt is actively being moved (to apply different styling).
    let moveTimeout; // Timeout ID for managing dragging class changes.
    let originalCenterImageSrc = ''; // Stores the full URL of the base image displayed on centerImage *before* any hover effects during a drag. This is crucial for reverting after a hover.
    let isHoveringCenterImage = false; // Flag to track if a dragged shirt is currently hovering over the centerImage and has triggered a hover image change.

    // --- Helper Functions ---

    // Finds a shirt DOM element by its 'data-shirt-name' attribute.
    // Not currently used in the active drag-and-drop logic but could be useful for other features.
    function findShirtElementByName(name) {
        for (const shirt of shirts) {
            if (shirt.getAttribute('data-shirt-name') === name) {
                return shirt;
            }
        }
        return null; 
    }

    // Updates the tooltip text based on the MODEL_INFO.
    function updateTooltip() { 
        if (!infoTooltip || !MODEL_INFO.mouse) return; // Guard clause if elements are missing.
        const tooltipText = `Model is ${MODEL_INFO.mouse.height} and wears size S`;
        infoTooltip.setAttribute('data-tooltip', tooltipText);
    }

    // --- Event Listener Setup for Shirts ---
    // Initialize each shirt for drag-and-drop.
    shirts.forEach(shirt => {
        shirt.style.cursor = 'grab'; // Set the cursor to 'grab' to indicate draggable items.
        // Add touch and mouse event listeners for starting the drag.
        // { passive: false } for touchstart allows us to call e.preventDefault().
        shirt.addEventListener('touchstart', (e) => { handleStart(e); }, { passive: false });
        shirt.addEventListener('mousedown', (e) => { handleStart(e); });
    });

    // --- Drag-and-Drop Event Handlers ---

    /**
     * Handles the start of a drag operation (mousedown or touchstart).
     * @param {Event} e - The mouse or touch event.
     */
    function handleStart(e) {
        e.preventDefault(); // Prevent default actions like text selection or image dragging.
        activeShirt = e.target; // Set the currently dragged shirt.

        // Capture the *base* version of the centerImage.src.
        // If centerImage is currently showing a "...ModelHover.png",
        // this logic ensures originalCenterImageSrc is set to the corresponding "...Model.png".
        // This is vital for correctly reverting the image if the drag ends without a drop,
        // or when the dragged shirt moves off the centerImage.
        if (centerImage && centerImage.src) {
            let currentCenterSrcURL;
            try {
                currentCenterSrcURL = new URL(centerImage.src, window.location.href);
            } catch(urlError) {
                console.warn("Error parsing centerImage.src in handleStart:", urlError);
                originalCenterImageSrc = centerImage.src; // Fallback
                isHoveringCenterImage = false; 
                return; 
            }
            
            const currentCenterPath = currentCenterSrcURL.pathname;
            const hoverSuffix = 'ModelHover.png';
            const baseSuffix = 'Model.png';

            if (currentCenterPath.endsWith(hoverSuffix)) {
                // If current image is a hover image, derive the base image path.
                const basePath = currentCenterPath.replace(hoverSuffix, baseSuffix);
                try {
                    originalCenterImageSrc = new URL(basePath, window.location.href).href;
                } catch (normalizationError) {
                    console.warn("Error creating URL for normalized base image in handleStart:", normalizationError);
                    originalCenterImageSrc = currentCenterSrcURL.href; // Fallback
                }
            } else {
                // If it's not a hover image, or not recognized, store its current URL as the original.
                originalCenterImageSrc = currentCenterSrcURL.href;
            }
        } else if (centerImage) {
            originalCenterImageSrc = ''; // Fallback if centerImage has no src.
        }
        
        isHoveringCenterImage = false; // Reset hover state at the start of a new drag.

        // Store the initial CSS position of the shirt.
        const computedStyle = window.getComputedStyle(activeShirt);
        initialShirtPos.left = computedStyle.left || '0px';
        initialShirtPos.top = computedStyle.top || '0px';
        // Initialize currentPos based on the parsed initial position.
        currentPos.x = parseInt(initialShirtPos.left) || 0;
        currentPos.y = parseInt(initialShirtPos.top) || 0;

        // Record initial mouse/touch coordinates and set up move/end listeners.
        if (e.type === 'mousedown') {
            lastX = e.clientX;
            lastY = e.clientY;
            initialTouchPos.x = e.clientX;
            initialTouchPos.y = e.clientY;
            document.addEventListener('mousemove', handleMove);
            document.addEventListener('mouseup', handleEnd);
        } else if (e.type === 'touchstart') {
            const touch = e.touches[0];
            lastX = touch.clientX;
            lastY = touch.clientY;
            initialTouchPos.x = touch.clientX;
            initialTouchPos.y = touch.clientY;
            // { passive: false } for touchmove allows us to call e.preventDefault().
            document.addEventListener('touchmove', handleMove, { passive: false });
            document.addEventListener('touchend', handleEnd);
            document.addEventListener('touchcancel', handleEnd); // Handle unexpected touch interruptions.
        }

        // Update shirt appearance for dragging.
        activeShirt.style.cursor = 'grabbing';
        activeShirt.style.zIndex = '1000'; // Bring to front.
        activeShirt.classList.add('grabbed'); // Add class for styling grabbed state.
    }

    /**
     * Handles the movement during a drag operation (mousemove or touchmove).
     * @param {Event} e - The mouse or touch event.
     */
    function handleMove(e) {
        if (!activeShirt || !centerImage) return; // Ensure we have an active shirt and a center image.
        e.preventDefault(); // Prevent scrolling or other default actions during drag.

        let clientX, clientY;
        // Get correct coordinates based on event type.
        if (e.type === 'mousemove') {
            clientX = e.clientX;
            clientY = e.clientY;
        } else if (e.type === 'touchmove') {
            const touch = e.touches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        }

        // Calculate change in position (delta).
        const deltaX = clientX - lastX;
        const deltaY = clientY - lastY;
        // Update current position.
        currentPos.x += deltaX;
        currentPos.y += deltaY;
        // Apply new position to the shirt.
        activeShirt.style.left = `${currentPos.x}px`;
        activeShirt.style.top = `${currentPos.y}px`;

        // --- Collision Detection and Hover Effect ---
        const shirtRect = activeShirt.getBoundingClientRect();
        const centerImageRect = centerImage.getBoundingClientRect();
        // Check for simple bounding box overlap between the dragged shirt and the center image.
        const collision = !(shirtRect.right < centerImageRect.left || 
                          shirtRect.left > centerImageRect.right || 
                          shirtRect.bottom < centerImageRect.top || 
                          shirtRect.top > centerImageRect.bottom);

        if (collision) {
            // If a collision occurs, try to show the hover image on centerImage.
            const currentDisplaySrcPath = new URL(centerImage.src, window.location.href).pathname;
            const hoverSuffix = 'ModelHover.png';
            const isAlreadyHovering = currentDisplaySrcPath.endsWith(hoverSuffix);
            
            // Only change to hover image if:
            // 1. Not already showing a hover image.
            // 2. We have a valid originalCenterImageSrc (base image to derive hover from).
            if (!isAlreadyHovering && originalCenterImageSrc) {
                let baseImageToHoverPath;
                try {
                    // Get the pathname of the *original* base image that was on centerImage.
                    baseImageToHoverPath = new URL(originalCenterImageSrc, window.location.href).pathname;
                } catch (urlError) {
                    console.warn("Error parsing originalCenterImageSrc in handleMove:", urlError);
                    baseImageToHoverPath = ''; // Safety net
                }

                // Ensure the base image is of a type that *can* be hovered (e.g., ends with 'Model.png').
                if (baseImageToHoverPath.endsWith('Model.png')) {
                    // Construct the potential hover image path for the *original* center image.
                    const potentialHoverPathForOriginal = baseImageToHoverPath.replace('Model.png', hoverSuffix);
                    
                    // Check if this derived hover path is one of the known valid hover images.
                    if (validHoverPaths.includes(potentialHoverPathForOriginal)) {
                        centerImage.src = potentialHoverPathForOriginal; // Change centerImage to its hover version.
                        isHoveringCenterImage = true; // Set flag.
                    }
                }
            }
        } else {
            // If no collision, and if we were previously hovering, revert centerImage to its original base image.
            if (isHoveringCenterImage && originalCenterImageSrc) { 
                centerImage.src = originalCenterImageSrc;
                isHoveringCenterImage = false; // Reset flag.
            }
        }

        // --- Visual Feedback for Dragging Direction ---
        const isMovingNow = Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2; // Threshold to detect actual movement.
        if (isMovingNow && !isMoving) {
            // If movement starts.
            activeShirt.classList.remove('grabbed');
            activeShirt.classList.add(deltaX > 0 ? 'dragging-right' : 'dragging-left');
            isMoving = true;
        } else if (isMoving && deltaX !== 0) {
            // If movement continues, update direction class.
            activeShirt.classList.remove('dragging-right', 'dragging-left');
            activeShirt.classList.add(deltaX > 0 ? 'dragging-right' : 'dragging-left');
        }
        
        // Update last known coordinates for the next move calculation.
        lastX = clientX;
        lastY = clientY;

        // Timeout to revert dragging classes if movement stops.
        if (moveTimeout) clearTimeout(moveTimeout);
        moveTimeout = setTimeout(() => {
            if (isMoving) {
                activeShirt.classList.remove('dragging-right', 'dragging-left');
                activeShirt.classList.add('grabbed'); // Revert to 'grabbed' if movement pauses.
                isMoving = false;
            }
        }, 50); // 50ms delay before considering movement stopped.
    }

    /**
     * Handles the end of a drag operation (mouseup or touchend).
     * @param {Event} e - The mouse or touch event.
     */
    function handleEnd(e) {
        if (!activeShirt || !centerImage) return; // Ensure active shirt and center image exist.

        // --- Collision Detection for Drop ---
        // This uses a more precise check: if the *center* of the dragged shirt is within the centerImage.
        const shirtRect = activeShirt.getBoundingClientRect();
        const centerImageRect = centerImage.getBoundingClientRect();
        const shirtCenterX = shirtRect.left + shirtRect.width / 2;
        const shirtCenterY = shirtRect.top + shirtRect.height / 2;
        
        const collision = shirtCenterX >= centerImageRect.left &&
                          shirtCenterX <= centerImageRect.right &&
                          shirtCenterY >= centerImageRect.top &&
                          shirtCenterY <= centerImageRect.bottom;

        if (collision) {
            // --- Successful Drop ---
            // Get the target model image source from the dragged shirt's data attribute.
            const newImageSrc = activeShirt.getAttribute('data-mouse-src');
            if (newImageSrc) {
                try {
                    // Set centerImage to the new model image (absolute path).
                    const fullPath = new URL(newImageSrc, window.location.href).pathname;
                    centerImage.src = fullPath;
                    // Update originalCenterImageSrc to this new base image.
                    // This is important so that subsequent hovers over this new image work correctly.
                    originalCenterImageSrc = fullPath; 
                } catch(urlError) {
                    console.warn(`Error creating URL for new image source: ${newImageSrc}`, urlError);
                    // Fallback to using the raw src if URL parsing fails.
                    centerImage.src = newImageSrc;
                    originalCenterImageSrc = newImageSrc; 
                }
                // const shirtName = activeShirt.getAttribute('data-shirt-name'); // Potentially for future use.
                updateTooltip(); // Update tooltip based on the new model/shirt.

                // Reset the dragged shirt's position back to its initial spot.
                activeShirt.style.left = initialShirtPos.left;
                activeShirt.style.top = initialShirtPos.top;
                currentPos.x = parseInt(initialShirtPos.left) || 0;
                currentPos.y = parseInt(initialShirtPos.top) || 0;
            }
        } else {
            // --- No Successful Drop (or dropped outside) ---
            // Reset the dragged shirt's position back to its initial spot.
            activeShirt.style.left = initialShirtPos.left;
            activeShirt.style.top = initialShirtPos.top;
            currentPos.x = parseInt(initialShirtPos.left) || 0;
            currentPos.y = parseInt(initialShirtPos.top) || 0;

            // If the centerImage was showing a hover effect (isHoveringCenterImage is true)
            // and we have a valid originalCenterImageSrc, revert centerImage to that original base image.
            if (isHoveringCenterImage && originalCenterImageSrc) {
                centerImage.src = originalCenterImageSrc;
            }
        }

        // --- Cleanup ---
        // Reset styles and classes on the dragged shirt.
        activeShirt.style.cursor = 'grab';
        activeShirt.style.zIndex = ''; // Reset z-index.
        activeShirt.classList.remove('dragging-right', 'dragging-left', 'grabbed');
        
        if (moveTimeout) clearTimeout(moveTimeout); // Clear any pending move timeout.

        // Remove event listeners that were added for the drag operation.
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleEnd);
        document.removeEventListener('touchmove', handleMove);
        document.removeEventListener('touchend', handleEnd);
        document.removeEventListener('touchcancel', handleEnd);

        isHoveringCenterImage = false; // Ensure hover state is reset.
        activeShirt = null; // Clear the active shirt.
    }

    // --- Tooltip Interaction ---
    if (infoTooltip) {
        // Toggle tooltip visibility on click.
        infoTooltip.addEventListener('click', (event) => {
            event.stopPropagation(); // Prevent the click from immediately triggering the document click listener.
            infoTooltip.classList.toggle('tooltip-visible');
        });

        // Hide tooltip if clicked outside of it.
        document.addEventListener('click', (event) => {
            if (infoTooltip.classList.contains('tooltip-visible') && !infoTooltip.contains(event.target)) {
                infoTooltip.classList.remove('tooltip-visible');
            }
        });
    } else {
        console.error('Info Tooltip element not found');
    }

    // Initial call to set up the tooltip text.
    updateTooltip();

    
}); 