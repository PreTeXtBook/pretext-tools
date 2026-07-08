<?xml version="1.0" encoding="UTF-8"?>
<!--
  GENERATED FILE - do not edit by hand.
  Regenerate with: npm run refresh-xsl -w @pretextbook/pretext-html

  Wrapper around pretext-html.xsl for single-page in-memory HTML builds
  (previews). The "file-wrap" template below is a verbatim copy of the
  upstream template with the <exsl:document> element removed, so the complete
  page is emitted on the main result tree. Intended to be applied together
  with a publication file that sets <html><platform portable="yes"/></html>,
  which forces chunk level 0 (one page) and CDN-hosted css/js, and suppresses
  most auxiliary file output. Remaining file writers are stubbed at the end.
-->
<xsl:stylesheet
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0"
    xmlns:xml="http://www.w3.org/XML/1998/namespace"
    xmlns:svg="http://www.w3.org/2000/svg"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:pi="http://pretextbook.org/2020/pretext/internal"
    xmlns:exsl="http://exslt.org/common"
    xmlns:date="http://exslt.org/dates-and-times"
    xmlns:str="http://exslt.org/strings"
    xmlns:fn="http://www.w3.org/2005/xpath-functions"
    xmlns:pf="https://prefigure.org"
    exclude-result-prefixes="svg xlink pi fn pf"
    extension-element-prefixes="exsl date str"
>

<xsl:import href="pretext-html.xsl"/>
<xsl:output method="html" encoding="UTF-8" doctype-system="about:legacy-compat"/>

<!-- Copied from pretext-html.xsl (mode="file-wrap"), exsl:document removed -->
<xsl:template match="*" mode="file-wrap">
    <xsl:param name="content" />
    <xsl:param name="title" select="''"/>
    <xsl:param name="filename" select="''"/>
    <xsl:param name="b-has-printout" select="false()"/>
    <xsl:param name="b-include-bottom-nav" select="true()"/>

    <xsl:variable name="the-filename">
        <xsl:choose>
            <xsl:when test="not($filename = '')">
                <xsl:value-of select="$filename"/>
            </xsl:when>
            <xsl:otherwise>
                <xsl:apply-templates select="." mode="containing-filename" />
            </xsl:otherwise>
        </xsl:choose>
    </xsl:variable>

    
    <xsl:call-template name="converter-blurb-html-no-date"/>
    <html>
        <xsl:call-template name="language-attributes"/>
        <xsl:call-template name="html-theme-attributes"/>
        <xsl:call-template name="pretext-advertisement-and-style"/>
        <!-- Open Graph Protocol only in "meta" elements, within "head" -->
        <head xmlns:og="http://ogp.me/ns#" xmlns:book="https://ogp.me/ns/book#">
            <!-- optional head content that needs to come prior to other content -->
            <xsl:apply-templates select="." mode="file-wrap-head-pre"/>
            <title>
                <xsl:choose>
                    <xsl:when test="$title != ''">
                        <xsl:value-of select="$title"/>
                    </xsl:when>
                    <xsl:otherwise>
                        <!-- Leading with initials is useful for small tabs -->
                        <xsl:if test="$docinfo/initialism">
                            <xsl:apply-templates select="$docinfo/initialism" />
                            <xsl:text> </xsl:text>
                        </xsl:if>
                        <xsl:apply-templates select="." mode="title-plain" />
                    </xsl:otherwise>
                </xsl:choose>
            </title>
            <!-- canonical link for better SEO -->
            <xsl:call-template name="canonical-link">
                <xsl:with-param name="filename" select="$the-filename"/>
            </xsl:call-template>
            <!-- grab the contents every page gets -->
            <xsl:copy-of select="$file-wrap-full-head-cache"/>
            <!-- now do anything that is or could be page-specific and comes after cache -->
            <xsl:apply-templates select="." mode="knowl" />
            <!-- webwork's iframeResizer needs to come before sagecell template -->
            <xsl:apply-templates select="." mode="sagecell" />
            <!-- optional head content that might override other content-->
            <xsl:apply-templates select="." mode="file-wrap-head-post"/>
        </head>
        <body>
            <xsl:if test="$b-has-stack">
                <xsl:attribute name="onload">
                    <xsl:text>docHasLoaded()</xsl:text>
                </xsl:attribute>
            </xsl:if>

            <!-- potential document-id per-page -->
            <xsl:call-template name="document-id"/>
            <!-- React flag -->
            <xsl:call-template name="react-in-use-flag"/>
            <!-- the first class controls the default icon -->
            <xsl:attribute name="class">
                <xsl:choose>
                    <xsl:when test="$root/book">pretext book</xsl:when>
                    <xsl:when test="$root/article">pretext article</xsl:when>
                </xsl:choose>
                <xsl:apply-templates select="." mode="file-wrap-body-attr-extra"/>
                <!-- ignore MathJax signals everywhere, then enable selectively -->
                <xsl:text> ignore-math</xsl:text>
            </xsl:attribute>
            <!-- assistive "Skip to main content" link    -->
            <!-- this *must* be first for maximum utility -->
            <xsl:call-template name="skip-to-content-link" />
            <!-- HTML5 body/header will be a "banner" landmark automatically -->
            <header id="ptx-masthead" class="ptx-masthead">
                <div class="ptx-banner">
                    <xsl:call-template name="brand-logo" />
                    <div class="title-container">
                        <h1 class="heading">
                            <xsl:variable name="root-filename">
                                <xsl:apply-templates select="$document-root" mode="containing-filename" />
                            </xsl:variable>
                            <a href="{$root-filename}">
                                <xsl:variable name="b-has-subtitle" select="boolean($document-root/subtitle)"/>
                                <span class="title">
                                    <!-- Do not use shorttitle in masthead,  -->
                                    <!-- which is much like cover of a book  -->
                                    <xsl:apply-templates select="$document-root" mode="title-simple" />
                                </span>
                                <xsl:if test="$b-has-subtitle and $b-html-banner-subtitle">
                                    <xsl:text> </xsl:text>
                                    <span class="subtitle">
                                        <xsl:apply-templates select="$document-root" mode="subtitle" />
                                    </span>
                                </xsl:if>
                            </a>
                        </h1>
                        <!-- Serial list of authors/editors -->
                        <xsl:if test="$b-html-banner-byline">
                            <p class="byline">
                                <xsl:apply-templates select="$bibinfo/author" mode="name-list"/>
                                <xsl:apply-templates select="$bibinfo/editor" mode="name-list"/>
                            </p>
                        </xsl:if>
                    </div>  <!-- title-container -->
                </div>  <!-- banner -->
            </header>  <!-- masthead -->
            <xsl:apply-templates select="." mode="primary-navigation"/>
            <xsl:apply-templates select="." mode="latex-macros"/>
            <div class="ptx-page">
                <xsl:apply-templates select="." mode="sidebars" />
                <!-- HTML5 main will be a "main" landmark automatically -->
                <main class="ptx-main">
                    <xsl:if test="$b-watermark">
                        <xsl:attribute name="style">
                            <xsl:value-of select="$watermark-css"/>
                        </xsl:attribute>
                    </xsl:if>
                    <div id="ptx-content" class="ptx-content">
                        <xsl:if test="$b-has-printout">
                            <xsl:apply-templates select="." mode="print-preview-header"/>
                        </xsl:if>
                        <!-- Alternative to "copy-of": convert $content to a  -->
                        <!-- node-set, and then hit with an identity template -->
                        <!-- to duplicate.  Experiment indicates no change in -->
                        <!-- output. (2023-01-11)                             -->
                        <xsl:copy-of select="$content" />
                    </div>
                    <xsl:if test="$b-include-bottom-nav">
                        <div id="ptx-content-footer" class="ptx-content-footer">
                            <xsl:apply-templates select="." mode="previous-button"/>
                            <xsl:variable name="top-localization">
                                <xsl:apply-templates select="." mode="type-name">
                                    <xsl:with-param name="string-id" select="'top'"/>
                                </xsl:apply-templates>
                            </xsl:variable>
                            <a class="top-button button" href="#" title="{$top-localization}">
                                <xsl:call-template name="insert-symbol">
                                    <xsl:with-param name="name" select="'expand_less'"/>
                                </xsl:call-template>
                                <span class="name">
                                    <xsl:value-of select="$top-localization"/>
                                </span>
                            </a>
                            <xsl:apply-templates select="." mode="next-button"/>
                        </div>
                    </xsl:if>
                </main>
            </div>
            <!-- formerly "extra" -->
            <div id="ptx-page-footer" class="ptx-page-footer">
                <xsl:apply-templates select="." mode="feedback-button"/>
                <xsl:call-template name="pretext-link" />
                <xsl:call-template name="runestone-link"/>
                <xsl:call-template name="mathjax-link" />
            </div>
            <xsl:copy-of select="$file-wrap-full-endbody-cache"/>
            <!-- For portable builds we stash the lunr search here -->
            <xsl:if test="$b-portable-html and $has-native-search">
                <xsl:call-template name="embedded-search-construction"/>
            </xsl:if>
            <!-- optional body content that needs to be inserted after all content -->
            <!-- e.g. script tags to run immediately                               -->
            <xsl:apply-templates select="." mode="file-wrap-body-post"/>
        </body>
    </html>
    
</xsl:template>

<!-- Stub out the remaining file writers (every other template reachable    -->
<!-- from pretext-html.xsl that contains exsl:document). Under portable-    -->
<!-- html several of these are already suppressed; the stubs cover the      -->
<!-- rest and act as a safety net if publication settings change. Any       -->
<!-- exsl:document that does fire aborts the FILESYSTEM=0 WASM build.       -->
<xsl:template name="index-redirect-page"/>
<xsl:template match="*" mode="manufacture-knowl"/>
<xsl:template name="ol-marker-styles"/>
<xsl:template name="doc-manifest"/>
<xsl:template name="search-page-construction"/>
<xsl:template name="scorm-manifest"/>
<!-- standalone pages for videos and iframe pages for interactives -->
<xsl:template match="*" mode="standalone-page"/>
<xsl:template match="*" mode="create-iframe-page"/>
<!-- runestone-manifest lives in pretext-runestone.xsl -->
<xsl:template match="*" mode="runestone-manifest"/>
<xsl:template match="*" mode="simple-file-wrap">
    <xsl:param name="content"/>
    <xsl:copy-of select="$content"/>
</xsl:template>

</xsl:stylesheet>
