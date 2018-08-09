import { Directive, ElementRef, Renderer2, Input, Output, EventEmitter, NgZone, HostListener } from '@angular/core';
import * as elementResizeDetectorMaker from 'element-resize-detector';

/**
 * Directive to truncate the contained text, if it exceeds the element's boundaries
 * and append characters (configurable, default '...') if so.
 */
@Directive({
  selector: '[ellipsis]'
})
export class EllipsisDirective {
  /**
   * Instance of https://github.com/wnr/element-resize-detector
   */
  private static elementResizeDetector: elementResizeDetectorMaker.Erd = null;

  /**
   * The original text (not truncated yet)
   */
  private originalText: string;
  
  private originalEnabled = true;

  /**
   * The referenced element
   */
  private elem: any;

  /**
   * Inner div element (will be auto-created)
   */
  private innerElem: any;

  /**
   * Wether the ellipsis should be applied on window resize
   */
  private applyOnWindowResize = false;

  /**
   * Remove function for the currently registered click listener 
   * on the link `this.ellipsisCharacters` are wrapped in.
   */
  private destroyMoreClickListener: () => void;

  /**
   * The ellipsis html attribute
   * If anything is passed, this will be used as a string to append to
   * the truncated contents.
   * Else '...' will be appended.
   */
  @Input('ellipsis') ellipsisCharacters: string;

  /**
   * The ellipsis-content html attribute
   * If passed this is used as content, else contents
   * are fetched from innerHTML
   */
  @Input('ellipsis-content') ellipsisContent: string = null;
  
  @Input('ellipsis-disabled') ellipsisDisabled: boolean = null;

  /**
   * The ellipsis-word-boundaries html attribute
   * If anything is passed, each character will be interpreted
   * as a word boundary at which the text may be truncated.
   * Else the text may be truncated at any character.
   */
  @Input('ellipsis-word-boundaries') ellipsisWordBoundaries: string;

  /**
   * The ellipsis-resize-detection html attribute
   * Algorithm to use to detect element/window resize - any of the following:
   * 'element-resize-detector': (default) Use https://github.com/wnr/element-resize-detector with its 'scroll' strategy
   * 'element-resize-detector-object': Use https://github.com/wnr/element-resize-detector with its 'object' strategy (deprecated)
   * 'window': Only check if the whole window has been resized/changed orientation by using angular's built-in HostListener
   */
  @Input('ellipsis-resize-detection') resizeDetectionStrategy: '' | 'element-resize-detector' | 'element-resize-detector-object' | 'window';

  /**
   * The ellipsis-click-more html attribute
   *  If anything is passed, the ellipsisCharacters will be
   *  wrapped in <a></a> tags and an event handler for the
   *  passed function will be added to the link
   */
  @Output('ellipsis-click-more') moreClickEmitter: EventEmitter<any> = new EventEmitter();



  /**
   * The directive's constructor
   */
  public constructor(private elementRef: ElementRef, private renderer: Renderer2, private ngZone: NgZone) { }

  /**
   * Angular's init view life cycle hook.
   * Initializes the element for displaying the ellipsis.
   */
  ngAfterViewInit() {
    // let the ellipsis characters default to '...':
    if (this.ellipsisCharacters == '') {
      this.ellipsisCharacters = '...';
    }
    
    if (this.moreClickEmitter.observers.length > 0) {
      this.ellipsisCharacters = `<a href="#" class="ngx-ellipsis-more">${this.ellipsisCharacters}</a>`;
    }

    // perform regex replace on word boundaries:
    if (!this.ellipsisWordBoundaries) {
      this.ellipsisWordBoundaries = '';
    }
    this.ellipsisWordBoundaries = "[" + this.ellipsisWordBoundaries.replace(/\\n/, "\n").replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "]";

    // store the original contents of the element:
    this.elem = this.elementRef.nativeElement;
    if (this.ellipsisContent) {
      this.originalText = this.ellipsisContent;
    }
    else if (!this.originalText) {
      this.originalText = this.elem.innerText;
    }

    // add a wrapper div (required for resize events to work properly):
    this.renderer.setProperty(this.elem, 'innerHTML', '');
    this.innerElem = this.renderer.createElement('div');
    this.renderer.addClass(this.innerElem, 'ngx-ellipsis-inner');
    const text = this.renderer.createText(this.originalText);
    this.renderer.appendChild(this.innerElem, text);
    this.renderer.appendChild(this.elem, this.innerElem);

    // start listening for resize events:
    this.addResizeListener(true);
  }

  /**
   * Angular's change life cycle hook.
   * Change original text (if the ellipsis-content has been passed)
   * and re-render
   */
  ngOnChanges() {
    if (!this.elem || !this.ellipsisContent || (this.originalText == this.ellipsisContent && this.originalEnabled == this.ellipsisDisabled)) {
      return;
    }
    
    console.log("Changes!");
    this.originalText = this.ellipsisContent;
    this.originalEnabled = this.ellipsisDisabled;
    
    this.applyEllipsis();
  }

  /**
   * Angular's destroy life cycle hook.
   * Remove event listeners
   */
  ngOnDestroy() {
    this.removeAllListeners();
  }

  /**
   * remove all resize listeners
   */
  private removeAllListeners() {
    if (this.destroyMoreClickListener) {
      this.destroyMoreClickListener();
    }

    this.removeResizeListener();
  }


  /**
   * Set up an event listener to call applyEllipsis() whenever a resize has been registered.
   * The type of the listener (window/element) depends on the resizeDetectionStrategy.
   * @param  {boolean} triggerNow=false if true, the ellipsis is applied immediately
   */
  private addResizeListener(triggerNow = false) {
    if (typeof(this.resizeDetectionStrategy) == 'undefined') {
      this.resizeDetectionStrategy = '';
    }
    switch (this.resizeDetectionStrategy) {
      case 'window':
        this.applyOnWindowResize = true;
        if (triggerNow) {
          this.applyEllipsis();
        }
        break;
      case 'element-resize-detector-object':
        this.addElementResizeListener(false);
        break;
      default:
        if (typeof (console) != 'undefined') {
          console.warn(`No such ellipsis-resize-detection strategy: '${this.resizeDetectionStrategy}' - Using 'element-resize-detector' instead`);
        }
      case 'element-resize-detector':
      case '':
        this.addElementResizeListener();
        break;
    }
  }

  @HostListener('window:resize', ['$event']) onResize(event: Event) {
    this.ngZone.run(() => {
      if (this.applyOnWindowResize) {
        this.applyEllipsis();
      }
    });
  }

  /**
   * Set up an event listener to call applyEllipsis() whenever the element
   * has been resized.
   * @param {boolean} scrollStrategy=true Use the default elementResizeDetector's strategy - s. https://github.com/wnr/element-resize-detector
   */
  private addElementResizeListener(scrollStrategy = true) {
    if (!EllipsisDirective.elementResizeDetector) {
      EllipsisDirective.elementResizeDetector = elementResizeDetectorMaker({ strategy: scrollStrategy ? 'scroll' : 'object' });
    }


    let calledAsynchronously = false;
    EllipsisDirective.elementResizeDetector.listenTo(this.elementRef.nativeElement, () => {
      if (!calledAsynchronously) {
        // elementResizeDetector fires the event directly after re-attaching the listener
        // -> discard that first event:
        return;
      }
      this.applyEllipsis();
    });
    calledAsynchronously = true;
  }

  /**
   * Stop listening for any resize event.
   */
  private removeResizeListener() {
    if (this.resizeDetectionStrategy != 'window') {
      if (EllipsisDirective.elementResizeDetector && this.elem) {
        EllipsisDirective.elementResizeDetector.removeAllListeners(this.elem);
      }
    }
    else {
      this.applyOnWindowResize = false;
    }
  }

  /**
   * Get the original text's truncated version. If the text really needed to
   * be truncated, this.ellipsisCharacters will be appended.
   * @param  {number} max the maximum length the text may have
   * @return string       the truncated string
   */
  private getTruncatedText(max: number): string {
    if (!this.originalText || this.originalText.length <= max) {
      return this.originalText;
    }

    let truncatedText = this.originalText.substr(0, max);
    if (this.ellipsisWordBoundaries == '[]' || this.originalText.charAt(max).match(this.ellipsisWordBoundaries)) {
      return truncatedText + this.ellipsisCharacters;
    }

    for (var i = max - 1; i > 0 && !truncatedText.charAt(i).match(this.ellipsisWordBoundaries); i--);
    return truncatedText.substr(0, i) + this.ellipsisCharacters;
  }

  /**
   * Set the truncated text to be displayed in the inner div
   * @param  {number} max the maximum length the text may have
   * @param {boolean} addMoreListener=false listen for click on the ellipsisCharacters if the text has been truncated
   */
  private truncateText(max: number, addMoreListener = false) {
    const text = this.getTruncatedText(max);
    this.renderer.setProperty(this.innerElem, 'innerHTML', text);

    if (!addMoreListener) {
      return;
    }

    // Remove any existing more click listener:
    if (this.destroyMoreClickListener) {
      this.destroyMoreClickListener();
    }

    // If the text has been truncated, add a more click listener:
    if (text != this.originalText) {
      this.destroyMoreClickListener = this.renderer.listen(this.innerElem, 'click', (e: any) => {
        if (!e.target || e.target.className != 'ngx-ellipsis-more') {
          return;
        }
        e.preventDefault();
        this.moreClickEmitter.emit(e);
      });
    }
  }


  /**
   * Display ellipsis in the inner div if the text would exceed the boundaries
   */
  private applyEllipsis() {  
    if (!this.ellipsisDisabled) {
      return;
    }
    
    // Remove the resize listener as changing the contained text would trigger events:
    this.removeResizeListener();

    // Find the best length by trial and error:
    const maxLength = EllipsisDirective.numericBinarySearch(this.originalText.length, curLength => {
      this.truncateText(curLength);
      return !this.isOverflowing;
    });

    // Apply the best length:
    this.truncateText(maxLength, (this.moreClickEmitter.observers.length > 0));

    // Re-attach the resize listener:
    this.addResizeListener();
  }


  /**
   * Whether the text is exceeding the element's boundaries or not
   */
  private get isOverflowing(): boolean {
    // Enforce hidden overflow (required to compare client width/height with scroll width/height)
    const currentOverflow = this.elem.style.overflow;
    if (!currentOverflow || currentOverflow === "visible") {
      this.elem.style.overflow = "hidden";
    }

    const isOverflowing = this.elem.clientWidth < this.elem.scrollWidth - 1 || this.elem.clientHeight < this.elem.scrollHeight - 1;

    // Reset overflow to the original configuration:
    this.elem.style.overflow = currentOverflow;

    return isOverflowing;
  }

  /**
   * Utility method to quickly find the largest number for
   * which `callback(number)` still returns true.
   * @param  {number} max      Highest possible number
   * @param  {number} callback Should return true as long as the passed number is valid
   * @return {number}          Largest possible number
   */
  private static numericBinarySearch(max: number, callback: (n: number) => boolean): number {
    let low = 0;
    let high = max;
    let best = -1;
    let mid: number;

    while (low <= high) {
      mid = ~~((low + high) / 2);
      const result = callback(mid);
      if (!result) {
        high = mid - 1;
      }
      else {
        best = mid;
        low = mid + 1;
      }
    }

    return best;
  }
}
