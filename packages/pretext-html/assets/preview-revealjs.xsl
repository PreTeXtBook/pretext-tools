<?xml version="1.0" encoding="UTF-8"?>
<!--
  GENERATED FILE - do not edit by hand.
  Regenerate with: npm run refresh-xsl -w @pretextbook/pretext-html

  Wrapper around pretext-revealjs.xsl for in-memory reveal.js slideshow builds
  (previews). The reveal.js conversion is already a single-page conversion, so
  unlike preview-html.xsl this copies no upstream template: it stubs the file
  writers (which a slide holding an "interactive" would otherwise trip) and
  stamps the ids the preview's source map needs onto slides and sections.

  Intended to be applied together with a publication file that forces
  <revealjs><resources host="cdn" math="online"/></revealjs>, since neither
  locally hosted nor embedded reveal.js resources exist for an in-memory build,
  and <html><resources host="cdn"/> for PreTeXt's own css/js on the slides.
-->
<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
    xmlns:exsl="http://exslt.org/common"
    extension-element-prefixes="exsl"
>

<xsl:import href="pretext-revealjs.xsl"/>
<xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

<!-- Stamp @id onto the reveal.js "section" that upstream builds for each     -->
<!-- slide (and each section of slides), without reproducing any of the       -->
<!-- upstream markup: render it via apply-imports, then re-emit the result    -->
<!-- with the id added to its first element. The id is the same @unique-id    -->
<!-- the rest of PreTeXt's HTML uses, which is what makes it findable from    -->
<!-- the source map. Attributes are copied before the id is set, so an        -->
<!-- upstream id (if one is ever added) is overridden rather than             -->
<!-- duplicated, and both precede any child content, as XSLT requires.        -->
<!--                                                                         -->
<!-- Only the *first* element is stamped, because a "section" does not always -->
<!-- render as one element: under the "linear" navigation mode upstream emits -->
<!-- the section's title slide followed by its slides as siblings. Those      -->
<!-- slides were rendered through this same template and carry their own ids  -->
<!-- already, so stamping every top-level element would duplicate the         -->
<!-- section's id across all of them.                                         -->
<xsl:template match="slide|section">
    <xsl:variable name="preview-id">
        <xsl:apply-templates select="." mode="html-id"/>
    </xsl:variable>
    <xsl:variable name="rendered">
        <xsl:apply-imports/>
    </xsl:variable>
    <!-- Bound once: two exsl:node-set calls on one fragment are not obliged -->
    <!-- to yield the same node identities, which the comparison relies on.  -->
    <xsl:variable name="tree" select="exsl:node-set($rendered)"/>
    <xsl:for-each select="$tree/node()">
        <xsl:choose>
            <xsl:when test="generate-id() = generate-id($tree/*[1])">
                <xsl:copy>
                    <xsl:copy-of select="@*"/>
                    <xsl:attribute name="id">
                        <xsl:value-of select="$preview-id"/>
                    </xsl:attribute>
                    <xsl:copy-of select="node()"/>
                </xsl:copy>
            </xsl:when>
            <xsl:otherwise>
                <xsl:copy-of select="."/>
            </xsl:otherwise>
        </xsl:choose>
    </xsl:for-each>
</xsl:template>

<!-- Same skipped passes and file-writer stubs as preview-html.xsl (a video -->
<!-- on a slide renders through the same templates); see SKIPPED_WORK_STUBS -->
<!-- and FILE_WRITER_STUBS.                                                 -->
<xsl:template match="*" mode="make-xref-knowls"/>
<xsl:template match="audio|video" mode="media-standalone-page"/>
<xsl:template name="index-redirect-page"/>
<xsl:template match="*" mode="manufacture-knowl"/>
<xsl:template name="ol-marker-styles"/>
<xsl:template name="doc-manifest"/>
<xsl:template name="search-page-construction"/>
<xsl:template name="scorm-manifest"/>
<!-- standalone pages for videos and interactives -->
<xsl:template match="*" mode="standalone-page"/>
<!-- iframe pages: none by default; IFRAME_PAGE_OVERRIDE, which follows   -->
<!-- these stubs in both wrappers, emits the ones that hold an interactive -->
<xsl:template match="*" mode="create-iframe-page"/>
<!-- runestone-manifest lives in pretext-runestone.xsl -->
<xsl:template match="*" mode="runestone-manifest"/>
<xsl:template match="*" mode="simple-file-wrap">
    <xsl:param name="content"/>
    <xsl:copy-of select="$content"/>
</xsl:template>

<!-- An interactive's iframe page, kept as in preview-html.xsl. -->
<!-- See iframePageOverride in refresh-xsl.mjs.                 -->
<xsl:template match="interactive[@platform]" mode="create-iframe-page">
    <xsl:variable name="if-filename">
        <xsl:apply-templates select="." mode="iframe-filename" />
    </xsl:variable>
    <template data-ptx-iframe-page="{$if-filename}">
        <xsl:call-template name="converter-blurb-html-no-date"/>
        <html>
            <xsl:call-template name="language-attributes"/>
            <head>
                <!-- grab the contents every iframe gets -->
                <xsl:copy-of select="$file-wrap-iframe-head-cache"/>
                <!-- now do anything that is or could be page-specific and comes after cache -->
                <!-- and CSS for the entire interactive, into the head -->
                <xsl:apply-templates select="@css" />
                <!-- load header libraries (for all "slate") -->
                <xsl:apply-templates select="." mode="header-libraries" />
            </head>
                <!-- ignore MathJax signals everywhere, then enable selectively -->
                <body class="ptx-content ignore-math">
                <!-- potential document-id per-page -->
                <xsl:call-template name="document-id"/>
                <!-- React flag -->
                <xsl:call-template name="react-in-use-flag"/>
                <!-- Some interactives use slates that are PreTeXt  -->
                <!-- elements, hence could have math, hence need to -->
                <!-- know globally available macros from the author -->
                <xsl:apply-templates select="." mode="latex-macros"/>
                <xsl:if test="slate|sidebyside|sbsgroup">
                    <div>
                        <!-- aspect ratio will force the proper height for wrapper div                           -->
                        <!-- don't want to mess with width as iframe has applied any % width and px is redundant -->
                        <xsl:attribute name="style">
                            <xsl:text>aspect-ratio: </xsl:text>
                            <xsl:apply-templates select="." mode="get-aspect-ratio"/>
                            <xsl:text>;</xsl:text>
                        </xsl:attribute>

                        <!-- stack, else use a layout -->
                        <xsl:apply-templates select="slate|sidebyside|sbsgroup" />
                    </div>
                </xsl:if>
                <!-- accumulate script tags *after* HTML elements -->
                <xsl:apply-templates select="@source" />
                <!-- accumulate script elements *after* @source scripts -->
                <xsl:apply-templates select="script"/>
            </body>
        </html>
    <xsl:comment>/ptx-iframe-page</xsl:comment></template>
</xsl:template>

</xsl:stylesheet>
